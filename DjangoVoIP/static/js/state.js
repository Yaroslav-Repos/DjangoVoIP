export const state = {
    localStream: null,
    livekitRoom: null,
    chatSocket: null,
    audioVolumeMap: {},
    isAudioReady: false,
    isMuted: false,
    connectedUsers: {},
    currentContextUserId: null,
    volumeBeforeMute: {},
    chatMessagesPage: 1,
    chatMessagesHasMore: false,
    isLoadingMessages: false,
    audioContext: null,
    mediaSource: null,
    analyser: null,
    animationFrameId: null,
    monitoringInterval: null,
    audioContextResumeInterval: null,
    isAdmin: false,

    isSharingScreen: false,
    localScreenStream: null,
    localScreenPublication: null,
    localScreenAudioPublication: null,
    localScreenWindow: null,
    remoteScreenTracks: {},
    remoteScreenAudioTracks: {},
    remoteScreenWindows: {},

    localAudioPublication: null, 
    remoteScreenPublications: {}, 

    wsReconnectAttempts: 0,
    maxWsReconnects: 3,
    isReconnectingLiveKit: false,
    livekitReconnectTimer: null

};
