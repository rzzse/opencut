function CSInterface() {}
CSInterface.prototype.getHostEnvironment = function() {
    return window.__adobe_cep__ ? JSON.parse(window.__adobe_cep__.getHostEnvironment()) : null;
};
CSInterface.prototype.evalScript = function(script, callback) {
    if (window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(script, callback || function() {});
    } else {
        if (callback) callback('ERR_NO_HOST');
    }
};
