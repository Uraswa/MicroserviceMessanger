import dotenv from "dotenv"

dotenv.config();

import {WebSocketServer} from "ws";
import InnerCommunicationService from "../services/innerCommunicationService.js";
import tokenService from "../services/tokenService.js";
import MessagesModel from "../Model/MessagesModel.js";
import ChatsModel from "../Model/ChatsModel.js";
import {ChatDecorator} from "./decorators/ChatDecorator.js";
import MemberDecorator from "./decorators/MemberDecorator.js";
import {ChatTextDecorator} from "./decorators/ChatTextDecorator.js";
import MessageAccessDecorator from "./decorators/MessageAccessDecorator.js";
import WebsocketDecorator from "./library/WebsocketDecorator.js";
import websocketResponseDTO from "./library/websocketResponseDTO.js";
import CacheConnector from "./library/OnlineCacheConnector.js";
import onlineCacheConnector from "./library/OnlineCacheConnector.js";
import RedisBrokerConnector from "./library/brokers/RedisBrokerConnector.js";


const websocket_instance = Number.parseInt(process.argv[2]) - 1;
let port = 8080 + websocket_instance;
console.log("RUNNING ON PORT", port)

await onlineCacheConnector.clearOnlineCache(websocket_instance);

const brokerConnector = RedisBrokerConnector;
await brokerConnector.initPublisher();

await setupRedisSubscriptions();

const clients = new Map();


const wss = new WebSocketServer({port: port});


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
        let message = await MessagesModel.createMessage(msg.chat.chat_id, user_id, msg.data.text);

        if (message && message.message_id) {

            let userProfileResp = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from([user_id]))}`, 8001)

            let nickname = 'Неизвестно'
            if (userProfileResp.status === 200 && userProfileResp.data.data.profiles.length !== 0) {
                nickname = userProfileResp.data.data.profiles[0].nickname;
            }

            await brokerConnector.sendToAllChatMembers({
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

        let updateReq = await MessagesModel.updateMessage(msg.data.chat_id, message.message_id, msg.data.text);
        if (updateReq) {
            await brokerConnector.sendToAllChatMembers({
                type: "updateMessage",
                success: true,
                data: response
            }, msg.chat.chat_id, user_id, false)
        } else {
            this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
        }

    }

    async deleteMessage(ws, user_id, msg) {
        let deleteMessageReq = await MessagesModel.deleteMessage(msg.data.chat_id, msg.data.message_id)
        if (deleteMessageReq) {
            await brokerConnector.sendToAllChatMembers({
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

    async leaveChat(ws, user_id, msg) {
        let chatParticipants = await ChatsModel.getChatParticipants(msg.chat.chat_id);
        let leaveChatResult = await ChatsModel.leaveChat(user_id, msg.data.chat_id);
        if (leaveChatResult) {
            await brokerConnector.sendToAllChatMembers({
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
        let chatParticipants = await ChatsModel.getChatParticipants(msg.chat.chat_id);
        if (msg.user_id === user_id) {
            this.send(websocketResponseDTO(msg, false, {}, "Self_kick_error"))
            return;
        }

        let kickResult = await ChatsModel.kickFromChat(msg.data.user_id, msg.data.chat_id);
        if (kickResult) {
            await brokerConnector.sendToAllChatMembers({
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

    async createChat(ws, user_id, msg) {
        let {chat_name, is_ls, other_user_id, text} = msg.data;
        if (other_user_id) {

            let otherUserResponse = await InnerCommunicationService.get('/api/doesUserExist?user_id=' + user_id, 8002);
            if (otherUserResponse.status !== 200 || !otherUserResponse.data.success || !otherUserResponse.data.data.exist) {
                this.send(websocketResponseDTO(msg, false, {}, "User_not_exist"))
                return;
            }

            if (await ChatsModel.getChatByOtherUserId(user_id, other_user_id)) {
                this.send(websocketResponseDTO(msg, false, {}, "Chat_already_exists"));
                return;
            }

            let privateChatRes = await ChatsModel.createPrivateChat(user_id, other_user_id)
            if (privateChatRes) {

                let userProfileResp = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from([user_id, other_user_id]))}`, 8001)

                let nickname1 = "";
                let nickname2 = "";

                if (userProfileResp.status === 200 && userProfileResp.data.data.profiles.length === 2) {
                    let prof1 = userProfileResp.data.data.profiles[0];
                    let prof2 = userProfileResp.data.data.profiles[1];

                    if (prof1.user_id === user_id) nickname1 = prof1.nickname;
                    else if (prof1.user_id === other_user_id) nickname2 = prof1.nickname;


                    if (prof2.user_id === user_id) nickname1 = prof2.nickname;
                    else if (prof2.user_id === other_user_id) nickname2 = prof2.nickname;
                }

                let promise1 = brokerConnector.sendToExactMember({
                    type: "createChat",
                    success: true,
                    data: {
                        chat_id: privateChatRes.chat_id,
                        other_user_id: user_id,
                        sender_id: other_user_id,
                        is_ls: true,
                        chat_name: `Чат с ${nickname1}`
                    }
                }, other_user_id);
                let promise2 = brokerConnector.sendToExactMember({
                    type: "createChat",
                    success: true,
                    data: {
                        chat_id: privateChatRes.chat_id,
                        other_user_id: other_user_id,
                        sender_id: user_id,
                        is_ls: true,
                        chat_name: `Чат с ${nickname2}`
                    }
                }, user_id);


                await promise1;
                await promise2;

                await this.route(ws, user_id, {
                    type: "sendMessage",
                    data: {
                        chat_id: privateChatRes.chat_id,
                        text: text
                    }
                })


            } else {

            }
        } else {
            if (!chat_name || chat_name.length > 40) {
                this.send(websocketResponseDTO(msg, false, {}, "Название чата не д.б. пустым или больше 40 символов!", "chat_name"))
                return;
            }

            let result = await ChatsModel.createGroupChat(user_id, chat_name);
            if (result) {
                await brokerConnector.sendToAllChatMembers({
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

        let result = await ChatsModel.updateGroupChat(msg.chat.chat_id, newchat_name);
        if (result) {
            await brokerConnector.sendToAllChatMembers({
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

        if (!msg.chat.is_ls && !msg.member.is_admin) {
            this.send(websocketResponseDTO(msg, false, {}, "Permission_denied"))
            return;
        }

        let chatParticipants = await ChatsModel.getChatParticipants(msg.chat.chat_id);
        let result = await ChatsModel.deleteGroupChat(msg.chat.chat_id, user_id);
        if (result) {
            await brokerConnector.sendToAllChatMembers({
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

    async clearChatHistory(ws, user_id, msg) {
        if (!msg.chat.is_ls && !msg.member.is_admin) {
            this.send(websocketResponseDTO(msg, false, {}, "Permission_denied"))
            return;
        }
        await MessagesModel.clearMessages(msg.chat.chat_id);
        await brokerConnector.sendToAllChatMembers({
            type: "clearChatHistory",
            success: true,
            data: {
                chat_id: msg.chat.chat_id
            }
        }, msg.chat.chat_id, user_id, false)
    }

    async blockUnblockUserInChat(ws, user_id, msg) {
        if (!msg.chat.is_ls && !msg.member.is_admin) {
            this.send(websocketResponseDTO(msg, false, {}, "Permission_denied"))
            return;
        }

        let {other_user_id, block_state} = msg.data;
        let otherMember = await ChatsModel.getChatMember(msg.chat.chat_id, other_user_id);

        if (!otherMember) {
            return this.send(websocketResponseDTO(msg, false, {}, "User_not_found"))

        }

        if (otherMember.is_blocked && block_state || !otherMember.is_blocked && !block_state) {
            return;
        }

        let blockUnblockResult = await ChatsModel.blockUnblockUserInChat(msg.chat.chat_id, other_user_id, block_state);
        if (!blockUnblockResult) {
            this.send(websocketResponseDTO(msg, false, "Unknown_error"))
            return;
        }

        await brokerConnector.sendToAllChatMembers({
            type: "blockUnblockUserInChat",
            success: true,
            data: {
                chat_id: msg.chat.chat_id,
                other_user_id: other_user_id,
                block_state: block_state
            }
        }, msg.chat.chat_id, user_id, false)
    }

}


let localConnectionsCounter = 0;

wss.on('connection', (ws, req) => {

    ws.localConnection = ++localConnectionsCounter;
    console.log(`Connection established: awaiting accessToken`);

    let controller = new WebsocketController();

    controller.on('sendMessage', new ChatDecorator(
        new MemberDecorator(
            new ChatTextDecorator(controller.createMessage.bind(controller)),
            false, true
        )
    ))

    controller.on('updateMessage', new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(
                new ChatTextDecorator(controller.updateMessage.bind(controller)), false),
            false, true
        )
    ))

    controller.on('deleteMessage', new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(controller.deleteMessage.bind(controller), true),
            false
        )
    ));

    controller.on('createChat', controller.createChat.bind(controller));

    controller.on('updateChat', new ChatDecorator(
        new MemberDecorator(controller.updateChat.bind(controller), true)
    ))

    controller.on('deleteChat', new ChatDecorator(
        new MemberDecorator(controller.deleteChat.bind(controller), false)
    ))

    controller.on('leaveChat', new ChatDecorator(
        new MemberDecorator(controller.leaveChat.bind(controller), false)
    ))

    controller.on('blockUnblockUserInChat', new ChatDecorator(
        new MemberDecorator(controller.blockUnblockUserInChat.bind(controller), false)
    ))

    controller.on('kickFromChat', new ChatDecorator(
        new MemberDecorator(controller.kickFromChat.bind(controller), true)
    ))

    controller.on('clearChatHistory', new ChatDecorator(
        new MemberDecorator(controller.clearChatHistory.bind(controller), false)
    ))


    let disconnectTimeout = setTimeout(() => {
        console.log("Access token wasn't received: disconnecting...")
        ws.terminate();
    }, 5000);

    let currentConnection = null;

    //TODO сделать автоматическое отключение по интервалу


    ws.on('message', async (message) => {
        try {
            let json4ik = JSON.parse(message.toString());
            let accessToken = json4ik.accessToken;

            let userData = tokenService.validateAccessToken(accessToken);

            if (!userData || !userData.user_id || currentConnection != null && currentConnection.user_id !== userData.user_id) {
                if (disconnectTimeout != null) clearTimeout(disconnectTimeout);
                ws.close(4001, "Not_authorized");
                return;
            }

            if (json4ik.type === "init") {
                clearTimeout(disconnectTimeout)
                disconnectTimeout = null;

                console.log(`User accessToken valid: ${userData.user_id}`);

                if (!clients.has(userData.user_id)) {
                    clients.set(userData.user_id, []);
                }


                currentConnection = {
                    ws: ws,
                    user_id: userData.user_id,
                    accessToken: accessToken
                };

                clients.get(userData.user_id).push(currentConnection);
                await onlineCacheConnector.addUserToWs(websocket_instance, userData.user_id);
                return;

            }

            await controller.route(ws, userData.user_id, json4ik);
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });


    ws.on('close', async () => {

        if (disconnectTimeout != null) clearTimeout(disconnectTimeout);
        if (currentConnection !== null) {
            console.log("Close event received for user: " + currentConnection.user_id);
            const userWs = clients.get(currentConnection.user_id);
            if (userWs) {
                const index = userWs.findIndex(v => v.ws.localConnection === ws.localConnection);
                if (index > -1) {
                    userWs.splice(index, 1);
                }
                if (userWs.length === 0) {
                    clients.delete(currentConnection.user_id);
                    console.log("LAST USER CONNECTION TO CURRENT WS!")
                    await CacheConnector.fullyRemoveUserFromWs(websocket_instance, currentConnection.user_id);
                }
            }
            console.log(`User disconnected: ${currentConnection.user_id}`);
            currentConnection = null;
        } else {
            console.log("Anonym user disconnected.")
        }

    });
});

async function setupRedisSubscriptions() {
    await brokerConnector.initSubscriber();

    await brokerConnector.brokerSubscribe('ws' + websocket_instance, (message, channel) => {
        try {
            const msg = JSON.parse(message);
            const recipientIds = msg.recipient_ids;

            for (let recipientId of recipientIds) {

                console.log(`Processing message for ${recipientId} from channel ${channel}`);
                if (clients.has(recipientId)) {
                    const recipientConnections = clients.get(recipientId);

                    for (const userConnection of recipientConnections) {
                        let {accessToken, ws, user_id} = userConnection;

                        if (userConnection.ws === null) continue;

                        if (!tokenService.validateAccessToken(accessToken)) {
                            userConnection.ws = null;
                            console.log(`Disconnecting user ${user_id}: not authorized`);
                            ws.close(4001, "Not_authorized");
                            continue;
                        }

                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(message);
                        }
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
    process.exit(0);
});

