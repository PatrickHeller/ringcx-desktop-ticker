'use strict';

// Direkter Port der Auth-/Datenlogik aus dashboard.php (ringcx-wordpress-wallboard)
// auf Node/Electron, inkl. zweistufigem JWT-Bearer -> Access-Token-Tausch-Flow.

function buildBasicAuth(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function postForm(url, headers, data) {
  const body = new URLSearchParams(data).toString();
  const res = await fetch(url, { method: 'POST', headers, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* keine JSON-Antwort */ }
  return { status: res.status, body: text, json };
}

async function getJson(url, headers) {
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* keine JSON-Antwort */ }
  return { status: res.status, body: text, json };
}

async function loginWithJwt(cfg) {
  const authUrl = cfg.AUTH_URL || 'https://platform.ringcentral.com/restapi/oauth/token';
  const baseUrl = cfg.BASE_URL.replace(/\/+$/, '');

  const rcHeaders = {
    Authorization: buildBasicAuth(cfg.CLIENT_ID, cfg.CLIENT_SECRET),
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const rcData = {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: cfg.JWT_ASSERTION,
  };
  const rcResponse = await postForm(authUrl, rcHeaders, rcData);
  if (rcResponse.status < 200 || rcResponse.status >= 300 || !rcResponse.json || !rcResponse.json.access_token) {
    throw new Error('RingEX Token Fehler: ' + rcResponse.body);
  }
  const ex = rcResponse.json;

  const cxHeaders = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
  const cxData = {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: cfg.JWT_ASSERTION,
    rcAccessToken: ex.access_token,
    rcTokenType: ex.token_type || 'Bearer',
  };
  const cxResponse = await postForm(baseUrl + '/api/auth/login/rc/accesstoken', cxHeaders, cxData);
  if (cxResponse.status < 200 || cxResponse.status >= 300 || !cxResponse.json || !cxResponse.json.accessToken) {
    throw new Error('RingCX Login Fehler: ' + cxResponse.body);
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    ringex_access_token: ex.access_token,
    ringex_token_type: ex.token_type || 'Bearer',
    ringex_expires_at: now + (parseInt(ex.expires_in, 10) || 3600) - 60,
    ringex_refresh_token: ex.refresh_token || null,
    ringex_refresh_expires_at: ex.refresh_token_expires_in ? now + parseInt(ex.refresh_token_expires_in, 10) - 60 : 0,
    ringcx_access_token: cxResponse.json.accessToken,
    ringcx_token_type: cxResponse.json.tokenType || 'Bearer',
    ringcx_expires_at: now + (parseInt(ex.expires_in, 10) || 3600) - 60,
  };
}

async function refreshRingexToken(cfg, cache) {
  if (!cache.ringex_refresh_token) throw new Error('Kein Refresh-Token.');
  const now = Math.floor(Date.now() / 1000);
  if (cache.ringex_refresh_expires_at && now >= cache.ringex_refresh_expires_at) {
    throw new Error('Refresh-Token abgelaufen.');
  }
  const authUrl = cfg.AUTH_URL || 'https://platform.ringcentral.com/restapi/oauth/token';
  const headers = {
    Authorization: buildBasicAuth(cfg.CLIENT_ID, cfg.CLIENT_SECRET),
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const data = { grant_type: 'refresh_token', refresh_token: cache.ringex_refresh_token };
  const response = await postForm(authUrl, headers, data);
  if (response.status < 200 || response.status >= 300 || !response.json || !response.json.access_token) {
    throw new Error('Refresh fehlgeschlagen.');
  }
  const json = response.json;
  return {
    ringex_access_token: json.access_token,
    ringex_token_type: json.token_type || 'Bearer',
    ringex_expires_at: now + (parseInt(json.expires_in, 10) || 3600) - 60,
    ringex_refresh_token: json.refresh_token || cache.ringex_refresh_token,
    ringex_refresh_expires_at: json.refresh_token_expires_in
      ? now + parseInt(json.refresh_token_expires_in, 10) - 60
      : (cache.ringex_refresh_expires_at || 0),
  };
}

async function loginRingcxWithRingex(cfg, ringexAccessToken, ringexTokenType) {
  const baseUrl = cfg.BASE_URL.replace(/\/+$/, '');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
  const data = {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: cfg.JWT_ASSERTION,
    rcAccessToken: ringexAccessToken,
    rcTokenType: ringexTokenType,
  };
  const response = await postForm(baseUrl + '/api/auth/login/rc/accesstoken', headers, data);
  if (response.status < 200 || response.status >= 300 || !response.json || !response.json.accessToken) {
    throw new Error('RingCX Login failed.');
  }
  return { ringcx_access_token: response.json.accessToken, ringcx_token_type: response.json.tokenType || 'Bearer' };
}

class RingCXClient {
  constructor(cfg, tokenStore) {
    this.cfg = cfg;
    // tokenStore: { load(): object, save(obj): void } - persistenter Cache (z.B. userData/token_cache.json)
    this.tokenStore = tokenStore;
  }

  async getValidToken() {
    const cache = this.tokenStore.load();
    const now = Math.floor(Date.now() / 1000);
    if (cache.ringcx_access_token && cache.ringcx_token_type && cache.ringcx_expires_at && now < cache.ringcx_expires_at) {
      return [cache.ringcx_access_token, cache.ringcx_token_type];
    }
    try {
      if (cache.ringex_refresh_token && cache.ringex_refresh_expires_at && now < cache.ringex_refresh_expires_at) {
        const refreshed = await refreshRingexToken(this.cfg, cache);
        const cx = await loginRingcxWithRingex(this.cfg, refreshed.ringex_access_token, refreshed.ringex_token_type);
        const newCache = { ...cache, ...refreshed, ...cx, ringcx_expires_at: refreshed.ringex_expires_at };
        this.tokenStore.save(newCache);
        return [newCache.ringcx_access_token, newCache.ringcx_token_type];
      }
    } catch (_) { /* fällt zurück auf frischen Login */ }
    const fresh = await loginWithJwt(this.cfg);
    this.tokenStore.save(fresh);
    return [fresh.ringcx_access_token, fresh.ringcx_token_type];
  }

  async authedGet(path) {
    let [accessToken, tokenType] = await this.getValidToken();
    const baseUrl = this.cfg.BASE_URL.replace(/\/+$/, '');
    const url = baseUrl + path;
    let headers = { Authorization: `${tokenType} ${accessToken}`, 'Content-Type': 'application/json' };
    let response = await getJson(url, headers);
    if (response.status === 401 && response.body.includes('Jwt is expired')) {
      this.tokenStore.save({});
      [accessToken, tokenType] = await this.getValidToken();
      headers = { Authorization: `${tokenType} ${accessToken}`, 'Content-Type': 'application/json' };
      response = await getJson(url, headers);
    }
    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.json)) {
      throw new Error(`API Fehler (${path}): HTTP ${response.status}`);
    }
    return response.json;
  }

  async getQueueData() {
    const accountId = this.cfg.ACCOUNT_ID;
    const raw = await this.authedGet(`/voice/api/v1/admin/accounts/${accountId}/realTimeData/inbound`);
    return raw.map((item) => {
      const calls = parseInt(item.accepted || 0, 10);
      const talkSec = parseInt(item.totalTalkTime || 0, 10);
      const waitSec = parseInt(item.totalQueueTime || 0, 10);
      const lngQueueTime = parseInt(item.longestInQueue || 0, 10);
      return {
        name: item.gateName || 'Unknown',
        state: String(item.state || 'UNKNOWN').toUpperCase(),
        queued: parseInt(item.inQueue || 0, 10),
        calls,
        offered: parseInt(item.presented || 0, 10),
        talk: talkSec,
        wait: waitSec,
        avg: calls > 0 ? Math.trunc(talkSec / calls) : 0,
        avgQueue: calls > 0 ? Math.trunc(waitSec / calls) : 0,
        lngQueue: lngQueueTime,
        abn: parseInt(item.abandoned || 0, 10),
        disconnect: parseInt(item.deflected || 0, 10),
      };
    });
  }

  async getAgentRealtimeData() {
    const accountId = this.cfg.ACCOUNT_ID;
    const raw = await this.authedGet(`/voice/api/v1/admin/accounts/${accountId}/realTimeData/agent`);
    return raw.map((item) => normalizeAgent(item, item.state || item.agentState || 'UNKNOWN'));
  }

  async getAllGroupAgents() {
    const accountId = this.cfg.ACCOUNT_ID;
    const agentGroupId = this.cfg.AGENT_GROUP_ID;
    const raw = await this.authedGet(`/voice/api/v1/admin/accounts/${accountId}/agentGroups/${agentGroupId}/agents`);
    return raw.map((item) => normalizeAgent(item, 'NICHT ANGEMELDET'));
  }

  async getAgents() {
    const [allAgents, liveAgents] = await Promise.all([this.getAllGroupAgents(), this.getAgentRealtimeData()]);
    return mergeAgentsWithRealtime(allAgents, liveAgents);
  }

  async getAll() {
    const [queues, agents] = await Promise.all([this.getQueueData(), this.getAgents()]);
    return { queues, agents };
  }
}

function normalizeAgent(item, state) {
  const firstName = String(item.firstName || '').trim();
  const lastName = String(item.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return {
    id: String(item.agentId || item.id || item.userId || ''),
    name: item.agentName || item.name || (fullName !== '' ? fullName : 'Unknown'),
    state: String(state).toUpperCase(),
    acd: item.callsHandled ?? '0',
    rna: item.rna ?? '0',
    agn_talk_time: parseInt(item.totalTalkTime || 0, 10),
    statusTime: parseInt(item.stateTime || 0, 10),
  };
}

function mergeAgentsWithRealtime(allAgents, liveAgents) {
  const liveById = new Map();
  const liveByName = new Map();
  for (const agent of liveAgents) {
    if (agent.id) liveById.set(String(agent.id), agent);
    liveByName.set(String(agent.name).toLowerCase().trim(), agent);
  }
  const merged = allAgents.map((agent) => {
    let match = null;
    if (agent.id && liveById.has(String(agent.id))) {
      match = liveById.get(String(agent.id));
    } else {
      const nameKey = String(agent.name).toLowerCase().trim();
      if (liveByName.has(nameKey)) match = liveByName.get(nameKey);
    }
    return match ? { ...agent, ...match } : agent;
  });
  merged.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return merged;
}

module.exports = { RingCXClient };
