/*
 * QuickBlox JavaScript SDK
 *
 * Chat 2.0 Module
 *
 */

/*
 * User's callbacks (listener-functions):
 * - onMessageListener
 * - onContactListListener
 * - onSubscribeListener
 * - onConfirmSubscribeListener
 * - onRejectSubscribeListener
 * - onDisconnectingListener
 * - onReconnectListener
 */

// Browserify exports and dependencies
require('../../lib/strophe/strophe.min');
var config = require('../qbConfig');
var Utils = require('../qbUtils');
module.exports = ChatProxy;

var dialogUrl = config.urls.chat + '/Dialog';
var messageUrl = config.urls.chat + '/Message';

var roster = {},
    joinedRooms = {};

// The object for type MongoDB.Bson.ObjectId
// http://docs.mongodb.org/manual/reference/object-id/
var ObjectId = {
  machine: Math.floor(Math.random() * 16777216).toString(16),
  pid: Math.floor(Math.random() * 32767).toString(16),
  increment: 0
};

// add extra namespaces for Strophe
Strophe.addNamespace('CARBONS', 'urn:xmpp:carbons:2');

// create Strophe Connection object
var protocol = config.chatProtocol.active === 1 ? config.chatProtocol.bosh : config.chatProtocol.websocket;
var connection = new Strophe.Connection(protocol);
// if (config.debug) {
  if (config.chatProtocol.active === 1) {
    connection.xmlInput = function(data) { if (data.childNodes[0]) {for (var i = 0, len = data.childNodes.length; i < len; i++) { console.log('[QBChat RECV]:', data.childNodes[i]); }} };
    connection.xmlOutput = function(data) { if (data.childNodes[0]) {for (var i = 0, len = data.childNodes.length; i < len; i++) { console.log('[QBChat SENT]:', data.childNodes[i]); }} };
  } else {
    connection.xmlInput = function(data) { console.log('[QBChat RECV]:', data); };
    connection.xmlOutput = function(data) { console.log('[QBChat SENT]:', data); };
  }
// }

function ChatProxy(service) {
  var self = this;

  this.service = service;
  this.roster = new RosterProxy(service);
  this.muc = new MucProxy(service);
  this.dialog = new DialogProxy(service);
  this.message = new MessageProxy(service);
  this.helpers = new Helpers;

  // reconnect to chat if it wasn't the logout method
  this._isLogout = false;

  // stanza callbacks (Message, Presence, IQ)

  this._onMessage = function(stanza) {
    var from = stanza.getAttribute('from'),
        to = stanza.getAttribute('to'),
        type = stanza.getAttribute('type'),
        body = stanza.querySelector('body'),
        invite = stanza.querySelector('invite'),
        extraParams = stanza.querySelector('extraParams'),        
        delay = type === 'groupchat' && stanza.querySelector('delay'),
        userId = type === 'groupchat' ? self.helpers.getIdFromResource(from) : self.helpers.getIdFromNode(from),
        message, extension, attachments, attach, attributes;

    if (invite) return true;

    // custom parameters
    if (extraParams) {
      extension = {};
      attachments = [];
      for (var i = 0, len = extraParams.childNodes.length; i < len; i++) {
        if (extraParams.childNodes[i].tagName === 'attachment') {
          
          // attachments
          attach = {};
          attributes = extraParams.childNodes[i].attributes;
          for (var j = 0, len2 = attributes.length; j < len2; j++) {
            if (attributes[j].name === 'id' || attributes[j].name === 'size')
              attach[attributes[j].name] = parseInt(attributes[j].value);
            else
              attach[attributes[j].name] = attributes[j].value;
          }
          attachments.push(attach);

        } else {
          extension[extraParams.childNodes[i].tagName] = extraParams.childNodes[i].textContent;
        }
      }

      if (attachments.length > 0)
        extension.attachments = attachments;
    }

    message = {
      type: type,
      body: (body && body.textContent) || null,
      extension: extension || null
    };

    // !delay - this needed to don't duplicate messages from chat 2.0 API history
    // with typical XMPP behavior of history messages in group chat
    if (typeof self.onMessageListener === 'function' && !delay)
      self.onMessageListener(userId, message, to);

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._onPresence = function(stanza) {
    var from = stanza.getAttribute('from'),
        type = stanza.getAttribute('type'),
        userId = self.helpers.getIdFromNode(from);

    if (!type) {
      if (typeof self.onContactListListener === 'function' && roster[userId] && roster[userId].subscription !== 'none')
        self.onContactListListener(userId);
    } else {

      // subscriptions callbacks
      switch (type) {
      case 'subscribe':
        if (roster[userId] && roster[userId].subscription === 'to') {
          roster[userId] = {
            subscription: 'both',
            ask: null
          };
          self.roster._sendSubscriptionPresence({
            jid: from,
            type: 'subscribed'
          });
        } else {
          if (typeof self.onSubscribeListener === 'function')
            self.onSubscribeListener(userId);
        }
        break;
      case 'subscribed':
        if (roster[userId] && roster[userId].subscription === 'from') {
          roster[userId] = {
            subscription: 'both',
            ask: null
          };          
        } else {
          roster[userId] = {
            subscription: 'to',
            ask: null
          };
          if (typeof self.onConfirmSubscribeListener === 'function')
            self.onConfirmSubscribeListener(userId);
        }
        break;
      case 'unsubscribed':
        roster[userId] = {
          subscription: 'none',
          ask: null
        };
        if (typeof self.onRejectSubscribeListener === 'function')
          self.onRejectSubscribeListener(userId);
        break;
      case 'unsubscribe':
        roster[userId] = {
          subscription: 'to',
          ask: null
        };
        // if (typeof self.onRejectSubscribeListener === 'function')
        //   self.onRejectSubscribeListener(userId);
        break;
      case 'unavailable':
        if (typeof self.onContactListListener === 'function' && roster[userId] && roster[userId].subscription !== 'none')
          self.onContactListListener(userId, type);
        break;
      }

    }

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };

  this._onIQ = function(stanza) {

    // we must return true to keep the handler alive
    // returning false would remove it after it finishes
    return true;
  };
}

/* Chat module: Core
---------------------------------------------------------------------- */
ChatProxy.prototype._autoSendPresence = function() {
  connection.send($pres().tree());
  // we must return true to keep the handler alive
  // returning false would remove it after it finishes
  return true;
};

ChatProxy.prototype.connect = function(params, callback) {
  if (config.debug) { console.log('ChatProxy.connect', params); }
  var self = this,
      err, rooms;

  connection.connect(params.jid, params.password, function(status) {
    switch (status) {
    case Strophe.Status.ERROR:
      err = getError(422, 'Status.ERROR - An error has occurred');
      if (typeof callback === 'function') callback(err, null);
      break;
    case Strophe.Status.CONNECTING:
      trace('Status.CONNECTING');
      trace('Chat Protocol - ' + (config.chatProtocol.active === 1 ? 'BOSH' : 'WebSocket'));
      break;
    case Strophe.Status.CONNFAIL:
      err = getError(422, 'Status.CONNFAIL - The connection attempt failed');
      if (typeof callback === 'function') callback(err, null);
      break;
    case Strophe.Status.AUTHENTICATING:
      trace('Status.AUTHENTICATING');
      break;
    case Strophe.Status.AUTHFAIL:
      err = getError(401, 'Status.AUTHFAIL - The authentication attempt failed');
      if (typeof callback === 'function') callback(err, null);
      break;
    case Strophe.Status.CONNECTED:
      trace('Status.CONNECTED at ' + getLocalTime());

      connection.addHandler(self._onMessage, null, 'message');
      connection.addHandler(self._onPresence, null, 'presence');
      connection.addHandler(self._onIQ, null, 'iq');

      // enable carbons
      self._enableCarbons(function() {
        // get the roster
        self.roster.get(function(contacts) {
          roster = contacts;

          // chat server will close your connection if you are not active in chat during one minute
          // initial presence and an automatic reminder of it each 55 seconds
          connection.send($pres().tree());
          connection.addTimedHandler(55 * 1000, self._autoSendPresence);

          if (typeof callback === 'function') {
            callback(null, roster);
          } else {
            self._isLogout = false;

            // recover the joined rooms
            rooms = Object.keys(joinedRooms);
            for (var i = 0, len = rooms.length; i < len; i++) {
              self.muc.join(rooms[i]);
            }

            if (typeof self.onReconnectListener === 'function')
              self.onReconnectListener();
          }
        });
      });

      break;
    case Strophe.Status.DISCONNECTING:
      trace('Status.DISCONNECTING');
      break;
    case Strophe.Status.DISCONNECTED:
      trace('Status.DISCONNECTED at ' + getLocalTime());
      connection.reset();

      if (typeof self.onDisconnectingListener === 'function')
        self.onDisconnectingListener();

      // reconnect to chat
      if (!self._isLogout) self.connect(params);
      break;
    case Strophe.Status.ATTACHED:
      trace('Status.ATTACHED');
      break;
    }
  });
};

ChatProxy.prototype.send = function(jid, message) {
  var self = this,
      msg = $msg({
        from: connection.jid,
        to: jid,
        type: message.type,
        id: message.id || self.helpers.getBsonObjectId()
      });
  
  if (message.body) {
    msg.c('body', {
      xmlns: Strophe.NS.CLIENT
    }).t(message.body).up();
  }
  
  // custom parameters
  if (message.extension) {
    msg.c('extraParams', {
      xmlns: Strophe.NS.CLIENT
    });
    
    Object.keys(message.extension).forEach(function(field) {
      if (field === 'attachments') {

        // attachments
        message.extension[field].forEach(function(attach) {
          msg.c('attachment', attach).up();
        });

      } else {
        msg.c(field).t(message.extension[field]).up();
      }
    });
  }
  
  connection.send(msg);
};

// helper function for ChatProxy.send()
ChatProxy.prototype.sendPres = function(type) {
  connection.send($pres({ 
    from: connection.jid,
    type: type
  }));
};

ChatProxy.prototype.disconnect = function() {
  joinedRooms = {};
  this._isLogout = true;
  connection.flush();
  connection.disconnect();
};

ChatProxy.prototype.addListener = function(params, callback) {
  return connection.addHandler(handler, null, params.name || null, params.type || null, params.id || null, params.from || null);

  function handler() {
    callback();
    // if 'false' - a handler will be performed only once
    return params.live !== false;
  }
};

ChatProxy.prototype.deleteListener = function(ref) {
  connection.deleteHandler(ref);
};

// Carbons XEP
// http://
ChatProxy.prototype._enableCarbons = function(callback) {
  var iq;

  iq = $iq({
    from: connection.jid,
    type: 'set',
    id: connection.getUniqueId('enableCarbons')
  }).c('enable', {
    xmlns: Strophe.NS.CARBONS
  });

  connection.sendIQ(iq, function(stanza) {
    callback();
  });
};

/* Chat module: Roster
 *
 * Integration of Roster Items and Presence Subscriptions
 * http://xmpp.org/rfcs/rfc3921.html#int
 * default - Mutual Subscription
 *
---------------------------------------------------------------------- */
function RosterProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

RosterProxy.prototype.get = function(callback) {
  var iq, self = this,
      items, userId, contacts = {};

  iq = $iq({
    from: connection.jid,
    type: 'get',
    id: connection.getUniqueId('getRoster')
  }).c('query', {
    xmlns: Strophe.NS.ROSTER
  });

  connection.sendIQ(iq, function(stanza) {
    items = stanza.getElementsByTagName('item');
    for (var i = 0, len = items.length; i < len; i++) {
      userId = self.helpers.getIdFromNode(items[i].getAttribute('jid')).toString();
      contacts[userId] = {
        subscription: items[i].getAttribute('subscription'),
        ask: items[i].getAttribute('ask') || null
      };
    }
    callback(contacts);
  });
};

RosterProxy.prototype.add = function(jid, callback) {
  var self = this,
      userId = self.helpers.getIdFromNode(jid).toString();

  roster[userId] = {
    subscription: 'none',
    ask: 'subscribe'
  };

  self._sendSubscriptionPresence({
    jid: jid,
    type: 'subscribe'
  });

  if (typeof callback === 'function') callback();
};

RosterProxy.prototype.confirm = function(jid, callback) {
  var self = this,
      userId = self.helpers.getIdFromNode(jid).toString();

  roster[userId] = {
    subscription: 'from',
    ask: 'subscribe'
  };

  self._sendSubscriptionPresence({
    jid: jid,
    type: 'subscribed'
  });

  self._sendSubscriptionPresence({
    jid: jid,
    type: 'subscribe'
  });

  if (typeof callback === 'function') callback();
};

RosterProxy.prototype.reject = function(jid, callback) {
  var self = this,
      userId = self.helpers.getIdFromNode(jid).toString();

  roster[userId] = {
    subscription: 'none',
    ask: null
  };

  self._sendSubscriptionPresence({
    jid: jid,
    type: 'unsubscribed'
  });

  if (typeof callback === 'function') callback();
};

RosterProxy.prototype.remove = function(jid, callback) {
  var iq, userId, self = this;

  iq = $iq({
    from: connection.jid,
    type: 'set',
    id: connection.getUniqueId('removeRosterItem')
  }).c('query', {
    xmlns: Strophe.NS.ROSTER
  }).c('item', {
    jid: jid,
    subscription: 'remove'
  });

  userId = self.helpers.getIdFromNode(jid).toString();

  connection.sendIQ(iq, function() {
    delete roster[userId];
    if (typeof callback === 'function') callback();
  });
};

RosterProxy.prototype._sendSubscriptionPresence = function(params) {
  var pres;

  pres = $pres({
    to: params.jid,
    type: params.type
  });

  connection.send(pres);
};

/* Chat module: Group Chat
 *
 * Multi-User Chat
 * http://xmpp.org/extensions/xep-0045.html
 *
---------------------------------------------------------------------- */
function MucProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

MucProxy.prototype.join = function(jid, callback) {
  var pres, self = this,
      id = connection.getUniqueId('join');

  joinedRooms[jid] = true;

  pres = $pres({
    from: connection.jid,
    to: self.helpers.getRoomJid(jid),
    id: id
  }).c("x", {
    xmlns: Strophe.NS.MUC
  }).c("history", {
    maxstanzas: 0
  });

  if (typeof callback === 'function') connection.addHandler(callback, null, 'presence', null, id);
  connection.send(pres);
};

MucProxy.prototype.leave = function(jid, callback) {
  var pres, self = this,
      roomJid = self.helpers.getRoomJid(jid);

  delete joinedRooms[jid];

  pres = $pres({
    from: connection.jid,
    to: roomJid,
    type: 'unavailable'
  });

  if (typeof callback === 'function') connection.addHandler(callback, null, 'presence', 'unavailable', null, roomJid);
  connection.send(pres);
};

/* Chat module: History
---------------------------------------------------------------------- */

// Dialogs

function DialogProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

DialogProxy.prototype.list = function(params, callback) {
  if (typeof params === 'function' && typeof callback === 'undefined') {
    callback = params;
    params = {};
  }

  if (config.debug) { console.log('DialogProxy.list', params); }
  this.service.ajax({url: Utils.getUrl(dialogUrl), data: params}, callback);
};

DialogProxy.prototype.create = function(params, callback) {
  if (config.debug) { console.log('DialogProxy.create', params); }
  this.service.ajax({url: Utils.getUrl(dialogUrl), type: 'POST', data: params}, callback);
};

DialogProxy.prototype.update = function(id, params, callback) {
  if (config.debug) { console.log('DialogProxy.update', id, params); }
  this.service.ajax({url: Utils.getUrl(dialogUrl, id), type: 'PUT', data: params}, callback);
};

DialogProxy.prototype.delete = function(id, callback) {
  if (config.debug) { console.log('DialogProxy.delete', id); }
  this.service.ajax({url: Utils.getUrl(dialogUrl, id), type: 'DELETE', dataType: 'text'}, callback);
};

// Messages

function MessageProxy(service) {
  this.service = service;
  this.helpers = new Helpers;
}

MessageProxy.prototype.list = function(params, callback) {
  if (config.debug) { console.log('MessageProxy.list', params); }
  this.service.ajax({url: Utils.getUrl(messageUrl), data: params}, callback);
};

MessageProxy.prototype.create = function(params, callback) {
  if (config.debug) { console.log('MessageProxy.create', params); }
  this.service.ajax({url: Utils.getUrl(messageUrl), type: 'POST', data: params}, callback);
};

MessageProxy.prototype.update = function(id, params, callback) {
  if (config.debug) { console.log('MessageProxy.update', id, params); }
  this.service.ajax({url: Utils.getUrl(messageUrl, id), type: 'PUT', data: params}, callback);
};

MessageProxy.prototype.delete = function(id, callback) {
  if (config.debug) { console.log('MessageProxy.delete', id); }
  this.service.ajax({url: Utils.getUrl(messageUrl, id), type: 'DELETE', dataType: 'text'}, callback);
};

/* Helpers
---------------------------------------------------------------------- */
function Helpers() {}

Helpers.prototype = {

  getUserJid: function(id, appId) {
    return id + '-' + appId + '@' + config.endpoints.chat;
  },

  getIdFromNode: function(jid) {
    return parseInt(Strophe.getNodeFromJid(jid).split('-')[0]);
  },

  getRoomJid: function(jid) {
    return jid + '/' + this.getIdFromNode(connection.jid);
  },  

  getIdFromResource: function(jid) {
    return parseInt(Strophe.getResourceFromJid(jid));
  },

  getUniqueId: function(suffix) {
    return connection.getUniqueId(suffix);
  },

  // Generating BSON ObjectId and converting it to a 24 character string representation
  // Changed from https://github.com/justaprogrammer/ObjectId.js/blob/master/src/main/javascript/Objectid.js
  getBsonObjectId: function() {
    var timestamp = Utils.unixTime().toString(16),
        increment = (ObjectId.increment++).toString(16);

    if (increment > 0xffffff) ObjectId.increment = 0;

    return '00000000'.substr(0, 8 - timestamp.length) + timestamp +
           '000000'.substr(0, 6 - ObjectId.machine.length) + ObjectId.machine +
           '0000'.substr(0, 4 - ObjectId.pid.length) + ObjectId.pid +
           '000000'.substr(0, 6 - increment.length) + increment;
  }

};

/* Private
---------------------------------------------------------------------- */
function trace(text) {
  // if (config.debug) {
    console.log('[QBChat]:', text);
  // }
}

function getError(code, detail) {
  var errorMsg = {
    code: code,
    status: 'error',
    message: code === 401 ? 'Unauthorized' : 'Unprocessable Entity',
    detail: detail
  };

  trace(detail);
  return errorMsg;
}

function getLocalTime() {
  return (new Date).toTimeString().split(' ')[0];
}
