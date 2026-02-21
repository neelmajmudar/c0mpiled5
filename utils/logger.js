const logger = {
    logs: [],
    lastWrite: 0,
    writeInterval: 5000,

    log(...args) {
        const entry = { level: 'log', timestamp: Date.now(), data: args };
        this.logs.push(entry);
        this._scheduleWrite();
    },

    error(...args) {
        const entry = { level: 'error', timestamp: Date.now(), data: args };
        this.logs.push(entry);
        this._scheduleWrite();
    },

    _scheduleWrite() {
        const now = Date.now();
        if (now - this.lastWrite >= this.writeInterval) {
            this._writeLogs();
        } else {
            clearTimeout(this._writeTimer);
            this._writeTimer = setTimeout(() => this._writeLogs(), this.writeInterval - (now - this.lastWrite));
        }
    },

    _writeLogs() {
        if (this.logs.length === 0) return;
        const logsToWrite = [...this.logs];
        this.logs = [];
        this.lastWrite = Date.now();
        try {
            chrome.runtime.sendMessage({ action: 'storeLogs', logs: logsToWrite });
        } catch (e) {
            // Extension context invalidated
        }
    }
};
