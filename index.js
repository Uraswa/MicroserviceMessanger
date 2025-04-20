import {WebSocketServer} from "ws";
import redis from "redis";
import * as model from "./db.js"
import axios from "axios";
import {sendToAllChatMembers, sendToExactMember, getChatParticipants} from "./brokerConnector";


const redisSubscriber = redis.createClient();

await redisSubscriber.connect();

await setupRedisSubscriptions();

const clients = new Map();


const wss = new WebSocketServer({port: 8080});

function websocketResponseDTO(msg, success, payload, error, error_field) {
    let resp = {
        type: msg.type + "Resp",
        success: success,
    };

    if (msg.localCode) {
        resp["localCode"] = msg.localCode;
    }

    if (error) {
        resp["error"] = error;
    }

    if (error_field) {
        resp["error_field"] = error_field;
    }

    if (payload) {
        resp["data"] = payload;
    }

    return resp;
}

class WebsocketController {

    routes = new Map();
    user_id;
    ws;

    async route(ws, user_id, msg) {
        let type = msg.type;
        if (this.routes.has(type)) {
            this.ws = ws;
            let controller = this.routes.get(type);
            await controller.call(ws, user_id, msg);
        }
    }

    on(route, callback) {
        this.routes.set(route, new WebsocketDecorator(callback))
    }

    send(msg) {
        this.ws.send(JSON.stringify(msg));
    }


    async createMessage(ws, user_id, msg) {
        let message = await model.createMessage(msg.chat.chat_id, user_id, msg.data.text);

        if (message && message.message_id) {

            let userProfileResp = await axios.get(`http://localhost:8001/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from([user_id]))}`)

            let nickname = 'Неизвестно'
            if (userProfileResp.status === 200 && userProfileResp.data.data.profiles.length !== 0) {
                nickname = userProfileResp.data.data.profiles[0].nickname;
            }

            await sendToAllChatMembers({
                type: "sendMessage",
                success: true,
                data: {
                    chat_id: msg.chat.chat_id,
                    user_id: user_id,
                    text: msg.data.text,
                    nickname: nickname,
                    message_id: message.message_id
                }
            }, msg.chat.chat_id, user_id, false);
        } else {
            this.send(websocketResponseDTO(msg, false, "Unknown_error"))
        }
    }

    async updateMessage(ws, user_id, msg) {
        let message = msg.message;

        let response = {
            chat_id: msg.chat.chat_id,
            message_id: message.message_id,
            text: msg.data.text
        };

        if (message.text === msg.data.text) {
            ws.send(JSON.stringify({
                type: "updateMessage",
                success: true,
                data: response
            }))
            return;
        }

        let updateReq = await model.updateMessage(message.message_id, msg.data.text);
        if (updateReq) {
            await sendToAllChatMembers({
                type: "updateMessage",
                success: true,
                data: response
            }, msg.chat.chat_id, user_id, false)
        } else {
            this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
        }

    }

    async deleteMessage(ws, user_id, msg) {
        let deleteMessageReq = await model.deleteMessage(msg.data.message_id)
        if (deleteMessageReq) {
            await sendToAllChatMembers({
                type: "deleteMessage",
                success: true,
                data: {
                    chat_id: msg.chat.chat_id,
                    message_id: deleteMessageReq.message_id
                }
            }, msg.chat.chat_id, user_id, false);
        } else {
            this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
        }
    }

    async joinChatByLink(ws, user_id, msg) {
        let joinRes = await model.joinChatByInviteLink(user_id, msg.data.link);
        if (joinRes.error) {
            this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
        } else if (joinRes.joined) {
            let chat = await model.getChatById(joinRes.chat_id);
            await sendToAllChatMembers({
                type: "chatMemberJoined",
                success: true,
                data: {
                    chat_id: chat.chat_id,
                    user_id: user_id
                }
            }, msg.chat.chat_id, user_id, false);
            this.send(websocketResponseDTO(msg, true, {chat_id: chat.chat_id}))
        }
    }

    async leaveChat(ws, user_id, msg) {
        let chatParticipants = await getChatParticipants(msg.chat.chat_id);
        let leaveChatResult = await model.leaveChat(user_id, msg.data.chat_id);
        if (leaveChatResult) {
            await sendToAllChatMembers({
                type: "chatMemberLeaved",
                success: true,
                data: {
                    chat_id: msg.data.chat_id,
                    user_id: user_id
                }
            }, msg.chat.chat_id, user_id, false, chatParticipants);
        } else {
            this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
        }
    }

    async kickFromChat(ws, user_id, msg) {
        let chatParticipants = await getChatParticipants(msg.chat.chat_id);
        if (msg.user_id === user_id) {
            this.send(websocketResponseDTO(msg, false, {}, "Self_kick_error"))
            return;
        }

        let kickResult = await model.kickFromChat(msg.data.user_id, msg.data.chat_id);
        if (kickResult) {
            await sendToAllChatMembers({
                type: "chatMemberLeaved",
                success: true,
                data: {
                    chat_id: msg.data.chat_id,
                    user_id: msg.data.user_id
                }
            }, msg.chat.chat_id, user_id, false, chatParticipants);
            return;
        }

        this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
    }

    async getInviteLink(ws, user_id, msg) {
        let inviteLink = await model.getOrCreateInvitationLink(msg.chat_id, user_id);
        if (!inviteLink) {
            this.send(websocketResponseDTO(msg, false, "Unknown_error"))
            return;
        }

        this.send(websocketResponseDTO(msg, true, {inviteLink}))
    }

    async createChat(ws, user_id, msg) {
        let {chat_name, is_ls, other_user_id} = msg.data;
        if (is_ls) {
            let otherUser = await model.getUserById(other_user_id);

            if (!otherUser) {
                this.send(websocketResponseDTO(msg, false, {}, "User_not_exist"))
                return;
            }

            let privateChatRes = await model.createPrivateChat(user_id, other_user_id)
            if (privateChatRes) {
                let promise1 = sendToExactMember({
                    type: "createChat",
                    success: true,
                    data: {
                        chat_id: privateChatRes.chat_id,
                        is_ls: true,
                        chat_name: `Чат с ${user_id}`
                    }
                }, other_user_id);
                let promise2 = sendToExactMember({
                    type: "createChat",
                    success: true,
                    data: {
                        chat_id: privateChatRes.chat_id,
                        is_ls: true,
                        chat_name: `Чат с ${other_user_id}`
                    }
                }, user_id);

                await promise1;
                await promise2;


            } else {

            }
        } else {
            if (!chat_name || chat_name.length > 40) {
                this.send(websocketResponseDTO(msg, false, {}, "Название чата не д.б. пустым или больше 40 символов!", "chat_name"))
                return;
            }

            let result = await model.createGroupChat(user_id, chat_name);
            if (result) {
                await sendToAllChatMembers({
                    type: "createChat",
                    success: true,
                    data: {
                        chat_id: result.chat_id,
                        chat_name: chat_name,
                        is_ls: false
                    }
                }, result.chat_id, user_id, false);
            } else {
                ws.send(JSON.stringify({type: "createChatResp", success: false, error: "Unknown_error"}));
            }
        }

    }

    async updateChat(ws, user_id, msg) {
        let newchat_name = msg.data.chat_name;

        if (msg.chat.is_ls) {
            ws.send(JSON.stringify({success: false, error: "Permission_denied"}));
            return;
        }

        if (!newchat_name || newchat_name.length > 40) {
            ws.send(JSON.stringify({
                success: false,
                type: "updateChatResp",
                error_field: "chat_name",
                error: "Название чата не д.б. пустым или больше 40 символов!"
            }));
            return;
        }

        let result = await model.updateGroupChat(msg.chat.chat_id, newchat_name);
        if (result) {
            await sendToAllChatMembers({
                type: "updateChat",
                success: true,
                data: {
                    chat_id: msg.chat.chat_id,
                    chat_name: newchat_name
                }
            }, msg.chat.chat_id, user_id, false)
            return;
        }

        ws.send(JSON.stringify({type: "updateChatResp", success: false, error: "Unknown_error"}));

    }

    async deleteChat(ws, user_id, msg) {
        let chatParticipants = await getChatParticipants(msg.chat.chat_id);
        let result = await model.deleteGroupChat(msg.chat.chat_id, user_id);
        if (result) {
            await sendToAllChatMembers({
                type: "deleteChat",
                success: true,
                data: {
                    chat_id: msg.chat.chat_id
                }
            }, msg.chat.chat_id, user_id, false, chatParticipants)
            return;
        }

        ws.send(JSON.stringify({type: "deleteChatResp", success: false, error: "Unknown_error"}));
    }

}

class WebsocketDecorator {
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

class ChatDecorator extends WebsocketDecorator {

    async callback(ws, user_id, msg) {
        let chat_id = msg.data.chat_id;
        let chat = await model.getChatById(chat_id);

        if (!chat) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Chat_not_exist"}));
        } else {
            msg.chat = chat;
            await this.call(ws, user_id, msg)
        }
    }
}

class MessageDecorator extends WebsocketDecorator {

    async callback(ws, user_id, msg) {

        let message = await model.getMessageById(msg.data.message_id);
        console.log(message)

        if (!message) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Chat_not_exist"}));
            return;
        }

        msg.data.chat_id = message.chat_id;
        msg.message = message;
        await this.call(ws, user_id, msg)

    }
}

class MemberDecorator extends WebsocketDecorator {

    constructor(callback, adminRequired) {
        super(callback);

        this.adminRequired = adminRequired;
    }

    async callback(ws, user_id, msg) {

        let member = await model.getChatMember(msg.data.chat_id, user_id);
        if (!member || !member.is_admin && this.adminRequired || member.is_kicked) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Permission_denied"}));
            return;
        }

        msg.member = member;

        await this.call(ws, user_id, msg);
    }

}

class ChatTextDecorator extends WebsocketDecorator {
    async callback(ws, user_id, msg) {

        let text = msg.data.text;
        if (!text || text.length > 256) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Message_len"}));
            return;
        }

        await this.call(ws, user_id, msg);
    }
}

class MessageAccessDecorator extends WebsocketDecorator {

    constructor(callback, isAdminActionAvailable) {
        super(callback);

        this.isAdminActionAvailable = isAdminActionAvailable;
    }

    async callback(ws, user_id, msg) {

        let message = await model.getMessageById(msg.data.message_id);
        if (!message) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Message_not_exist"}));
            return;
        }

        if (message.user_id !== user_id && (!this.isAdminActionAvailable || this.isAdminActionAvailable && !msg.member.is_admin)) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Permission_denied"}));
            return;
        }

        msg.message = message;

        await this.call(ws, user_id, msg);
    }
}


wss.on('connection', (ws, req) => {

    const url = new URL(req.url, `http://${req.headers.host}`);
    let user_id = url.searchParams.get('user_id');

    if (!user_id) {
        ws.close(4001, 'User ID required');
        return;
    }

    user_id = Number.parseInt(user_id);

    console.log(`User connected: ${user_id}`);

    if (!clients.has(user_id)) {
        clients.set(user_id, []);
    }
    clients.get(user_id).push(ws);

    let controller = new WebsocketController();

    controller.on('sendMessage', new ChatDecorator(
        new MemberDecorator(new ChatTextDecorator(controller.createMessage), false)
    ))

    controller.on('updateMessage', new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(
                new ChatTextDecorator(controller.updateMessage), false),
            false
        )
    ))

    controller.on('deleteMessage', new MessageDecorator(new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(controller.deleteMessage, true),
            false
        )
    )))

    controller.on('createChat', controller.createChat);

    controller.on('updateChat', new ChatDecorator(
        new MemberDecorator(controller.updateChat, true)
    ))

    controller.on('deleteChat', new ChatDecorator(
        new MemberDecorator(controller.deleteChat, true)
    ))

    controller.on('leaveChat', new ChatDecorator(
        new MemberDecorator(controller.leaveChat, false)
    ))

    controller.on('kickFromChat', new ChatDecorator(
        new MemberDecorator(controller.kickFromChat, true)
    ))

    controller.on('getInviteLink', new ChatDecorator(
        new MemberDecorator(controller.getInviteLink, false)
    ))

    controller.on('joinChat', controller.joinChatByLink)


    ws.on('message', async (message) => {
        try {
            let json4ik = JSON.parse(message.toString());
            await controller.route(ws, user_id, json4ik);
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });


    ws.on('close', () => {
        const userWs = clients.get(user_id);
        if (userWs) {
            const index = userWs.indexOf(ws);
            if (index > -1) {
                userWs.splice(index, 1);
            }
            if (userWs.length === 0) {
                clients.delete(user_id);
            }
        }
        console.log(`User disconnected: ${user_id}`);
    });
});

async function setupRedisSubscriptions() {


    // In a real app, you might want dynamic subscription management
    // For this example, we'll subscribe to a pattern that matches all user channels
    await redisSubscriber.pSubscribe('user:*', (message, channel) => {
        try {
            const msg = JSON.parse(message);
            const recipientId = msg.recipient_id;

            console.log(`Processing message for ${recipientId} from channel ${channel}`);

            if (clients.has(recipientId)) {
                const recipientConnections = clients.get(recipientId);

                for (const ws of recipientConnections) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(message);
                    }
                }
            }
        } catch (err) {
            console.error('Error processing Redis message:', err);
        }
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');

    await redisPublisher.quit();
    await redisSubscriber.quit();
    process.exit(0);
});

