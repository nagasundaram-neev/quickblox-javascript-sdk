/**
 * QuickBlox VideoChat WebRTC library
 *
 */

// Browserify dependencies
var adapter = require('../libs/adapter');
var pcConfig = require('./config');
var QBSignaling = require('./qbSignaling');

window.QBSignaling = QBSignaling;
window.QBVideoChat = QBVideoChat;

var PC_CONSTRAINTS = {
	'optional': []
};

var SDP_CONSTRAINTS = {
	'optional': [],
	'mandatory': {
		'OfferToReceiveAudio': true,
		'OfferToReceiveVideo': true
	}
};

var QBVideoChatState = {
	INACTIVE: 'inactive',
	ESTABLISHING: 'establishing'
};

var QBStopReason = {
	MANUALLY: 'kStopVideoChatCallStatus_Manually',
	BAD_CONNECTION: 'kStopVideoChatCallStatus_BadConnection',
	CANCEL: 'kStopVideoChatCallStatus_Cancel',
	NOT_ANSWER: 'kStopVideoChatCallStatus_OpponentDidNotAnswer'
};

function QBVideoChat(signaling, params) {
 	var self = this;
 	
 	this.version = '0.6.2';
 	this.stopReason = QBStopReason;
 	
	this._state = QBVideoChatState.INACTIVE;
	this._candidatesQueue = [];
	this.localVideoElement = null;
	this.remoteVideoElement = null;
	
	if (params) {
		this._debug = params.debug || null;
		
		this.sessionID = params.sessionID || new Date().getTime();
		this.remoteSessionDescription = params.sessionDescription || null;
		this.constraints = params.constraints || null;
		
		traceVC("sessionID " + this.sessionID);
		
		// set user callbacks
		this._callbacks = {
			onGetUserMediaSuccess: params.onGetUserMediaSuccess || null,
			onGetUserMediaError: params.onGetUserMediaError || null
		};
	}
	
	// Signalling callbacks
	this.onAcceptSignalingCallback = function(sessionDescription) {
		self.setRemoteDescription(sessionDescription, "answer");
	};
	
	this.addCandidate = function(data) {
		var candidate;
		
		candidate = new adapter.RTCIceCandidate(data);
		self.pc.addIceCandidate(candidate);
	};
	
	this.signaling = signaling;
	this.signaling._callbacks.onInnerAcceptCallback = this.onAcceptSignalingCallback;
	this.signaling._callbacks.onCandidateCallback = this.addCandidate;
	
	// MediaStream getUserMedia
	this.getUserMedia = function() {
		traceVC("getUserMedia...");
		
		adapter.getUserMedia(self.constraints, successCallback, errorCallback);
		
		function successCallback(localMediaStream) {
			traceVC("getUserMedia success");
			self.localStream = localMediaStream;
			self.createRTCPeerConnection();
			self._callbacks.onGetUserMediaSuccess();
		}
		
		function errorCallback(error) {
			traceVC("getUserMedia error: " + JSON.stringify(error));
			self._callbacks.onGetUserMediaError();
		}
	};
	
	// MediaStream attachMedia
	this.attachMediaStream = function(elem, stream) {
		adapter.attachMediaStream(elem, stream);
	}
	
	// MediaStream reattachMedia
	this.reattachMediaStream = function(to, from) {
		adapter.reattachMediaStream(to, from);
	}
	
	// RTCPeerConnection creation
	this.createRTCPeerConnection = function() {
		traceVC("RTCPeerConnection...");
		try {
			self.pc = new adapter.RTCPeerConnection(pcConfig, PC_CONSTRAINTS);
			self.pc.addStream(self.localStream);
			self.pc.onicecandidate = self.onIceCandidateCallback;
			self.pc.onaddstream = self.onRemoteStreamAddedCallback;
			traceVC('RTCPeerConnnection created');
		} catch (e) {
			traceVC('RTCPeerConnection failed: ' + e.message);
		}
	};
	
	// onIceCandidate callback
	this.onIceCandidateCallback = function(event) {
		var candidate = event.candidate;
		
		if (candidate) {
			if (self._state == QBVideoChatState.INACTIVE)
				self._candidatesQueue.push(candidate);
			else {
				// Send ICE candidate to opponent
				self.signaling.sendCandidate(self.opponentID, candidate, self.sessionID);
			}
		}
	};

	// onRemoteStreamAdded callback
	this.onRemoteStreamAddedCallback = function(event) {
		traceVC('Remote stream added');
		self.remoteStream = event.stream;
		self.attachMediaStream(self.remoteVideoElement, event.stream);
	};
	
	// Set LocalDescription
	this.onGetSessionDescriptionSuccessCallback = function(sessionDescription) {
		traceVC('LocalDescription...');
		
		self.pc.setLocalDescription(sessionDescription,
                                
                                function onSuccess() {
                                  traceVC('LocalDescription success');
                                  self.localSessionDescription = sessionDescription;
                                  
                                  // ICE gathering starts work here
                                  if (sessionDescription.type === 'offer')
                                    self.sendCallRequest();
                                  else if (sessionDescription.type === 'answer')
                                    self.sendAceptRequest();
                                },
                                
                                function onError(error) {
                                  traceVC('LocalDescription error: ' + JSON.stringify(error));
                                }
		);
	};

	this.onCreateOfferFailureCallback = function(error) {
		traceVC('createOffer() error: ' + JSON.stringify(error));
	};
	
	// Set RemoteDescription
	this.setRemoteDescription = function(descriptionSDP, descriptionType) {
		traceVC('RemoteDescription...');
		var sessionDescription, candidate;
		
		self._state = QBVideoChatState.ESTABLISHING;
		sessionDescription = new adapter.RTCSessionDescription({sdp: descriptionSDP, type: descriptionType});
		
		self.pc.setRemoteDescription(sessionDescription,
                                 
                                 function onSuccess() {
                                   traceVC("RemoteDescription success");
                                   
                                   if (sessionDescription.type === 'offer')
                                     self.pc.createAnswer(self.onGetSessionDescriptionSuccessCallback, self.onCreateAnswerFailureCallback, SDP_CONSTRAINTS);
                                 },
                                 
                                 function onError(error) {
                                   traceVC('RemoteDescription error: ' + JSON.stringify(error));
                                 }
		);
		
		// send candidates
		for (var i = 0; i < self._candidatesQueue.length; i++) {
			candidate = self._candidatesQueue.pop();
			self.signaling.sendCandidate(self.opponentID, candidate, self.sessionID);
		}
	};
	
	this.onCreateAnswerFailureCallback = function(error) {
		traceVC('createAnswer() error: ' + JSON.stringify(error));
	};
	
	this.sendCallRequest = function() {
		// Send only string representation of sdp
		// http://www.w3.org/TR/webrtc/#rtcsessiondescription-class
	
		self.signaling.call(self.opponentID, self.localSessionDescription.sdp, self.sessionID, self.extraParams);
	};
	
	this.sendAceptRequest = function() {
		// Send only string representation of sdp
		// http://www.w3.org/TR/webrtc/#rtcsessiondescription-class
	
		self.signaling.accept(self.opponentID, self.localSessionDescription.sdp, self.sessionID, self.extraParams);
	};

	// Cleanup 
	this.hangup = function() {
		self._state = QBVideoChatState.INACTIVE;
		self.signaling = null;
		self.localStream.stop();
		self.pc.close();
		self.pc = null;
	};
}

function traceVC(text) {
	console.log("[qb_videochat]: " + text);
}

/* Public methods
----------------------------------------------------------*/
// Call to user
QBVideoChat.prototype.call = function(userID, extraParams) {
	if (this.localSessionDescription) {
		this.sendCallRequest();
	} else {
		this.opponentID = userID;
		this.extraParams = extraParams;
		
		this.pc.createOffer(this.onGetSessionDescriptionSuccessCallback, this.onCreateOfferFailureCallback, SDP_CONSTRAINTS);
	}
};

// Accept call from user 
QBVideoChat.prototype.accept = function(userID, extraParams) {
	this.opponentID = userID;
	this.extraParams = extraParams;
	this.setRemoteDescription(this.remoteSessionDescription, "offer");
};

// Reject call from user
QBVideoChat.prototype.reject = function(userID, extraParams) {
	this.signaling.reject(userID, this.sessionID, extraParams);
};

// Stop call with user
QBVideoChat.prototype.stop = function(userID, extraParams) {
	this.signaling.stop(userID, this.sessionID, extraParams);
};
