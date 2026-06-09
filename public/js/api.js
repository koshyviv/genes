'use strict';

// Thin wrapper around the server API.
const API = (() => {
  async function call(method, url, body, rawBody, contentType) {
    const opts = { method, headers: {} };
    if (rawBody) {
      opts.body = rawBody;
      if (contentType) opts.headers['Content-Type'] = contentType;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : ('Request failed (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    getData: () => call('GET', '/api/data'),
    getAuth: () => call('GET', '/api/auth'),
    login: (password) => call('POST', '/api/auth/login', { password }),
    logout: () => call('POST', '/api/auth/logout', {}),
    saveMeta: (meta) => call('PUT', '/api/meta', meta),
    saveHistory: (text) => call('PUT', '/api/history', { text }),
    createPerson: (p) => call('POST', '/api/persons', p),
    updatePerson: (id, p) => call('PUT', '/api/persons/' + id, p),
    deletePerson: (id) => call('DELETE', '/api/persons/' + id),
    uploadPhoto: (id, file) => call('POST', '/api/persons/' + id + '/photo', undefined, file, file.type),
    createUnion: (u) => call('POST', '/api/unions', u),
    updateUnion: (id, u) => call('PUT', '/api/unions/' + id, u),
    deleteUnion: (id) => call('DELETE', '/api/unions/' + id),
    addChild: (unionId, childId) => call('POST', '/api/unions/' + unionId + '/children', { childId }),
    removeChild: (unionId, childId) => call('DELETE', '/api/unions/' + unionId + '/children/' + childId),
    importAll: (data) => call('POST', '/api/import', data)
  };
})();
