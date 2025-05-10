export default class WebsocketDecorator {
    _callback;

    constructor(callback) {
        this._callback = callback;
    }

    async call(ws, user_id, msg) {
        if (typeof (this._callback) === "function") {
            await this._callback(ws, user_id, msg);
        } else {
            await this._callback.callback(ws, user_id, msg)
        }
    }

    async callback(ws, user_id, msg) {

    }
}