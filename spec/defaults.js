
/*
 *  Contains the default expected settings etc
 *
 */

var DEFAULTS = {
  version: '1.3.6',
  creds: {
    appId: '',
    authKey: '',
    authSecret: ''
  },
  endpoints: {
    api: 'api.quickblox.com',
    chat: 'chat.quickblox.com',
    muc: 'muc.chat.quickblox.com',
    turn: 'turnserver.quickblox.com',
    s3Bucket: 'qbprod'
  },
  chatProtocol: {
    //bosh: 'http://chat.quickblox.com:8080',
    bosh: 'https://chat.quickblox.com:8081', // With SSL
    websocket: 'ws://chat.quickblox.com:5290',
    active: 1
  },
  urls: {
    session: 'session',
    login: 'login',
    users: 'users',
    chat: 'chat',
    blobs: 'blobs',
    geodata: 'geodata',
    places: 'places',
    pushtokens: 'push_tokens',
    subscriptions: 'subscriptions',
    events: 'events',
    data: 'data',
    type: '.json'
  },
  ssl: true,
  debug: false
};

// Default timeout for calls to the API
var TIMEOUT = 5000;

var VALID_USER='qb-temp', VALID_PASSWORD = 'someSecret';
var INVALID_USER='notRegistered', INVALID_PASSWORD = 'doNotCare';
