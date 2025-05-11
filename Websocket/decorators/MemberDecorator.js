import WebsocketDecorator from "../library/WebsocketDecorator.js";
import ApplicationCache from "../library/ApplicationCache.js";

export default class MemberDecorator extends WebsocketDecorator {

    constructor(callback, adminRequired, mustBeNotBlocked) {
        super(callback);

        this.adminRequired = adminRequired;
        this.mustBeNotBlocked = mustBeNotBlocked;
    }

    async callback(ws, user_id, msg) {

        let member = await ApplicationCache.getChatMember(msg.data.chat_id, user_id);
        if (!member || !member.is_admin && this.adminRequired || member.is_kicked || this.mustBeNotBlocked && member.is_blocked) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Permission_denied"}));
            return;
        }

        msg.member = member;

        await this.call(ws, user_id, msg);
    }

}