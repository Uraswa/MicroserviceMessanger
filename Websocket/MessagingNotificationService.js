import dotenv from "dotenv"

dotenv.config();

import {WebSocketServer} from "ws";
import InnerCommunicationService from "../services/innerCommunicationService.js";
import tokenService from "../services/tokenService.js";
import MessagesModel from "../Model/MessagesModel.js";
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
        let message = await MessagesModel.createMessage(msg.data.chat_id, user_id, msg.data.text);

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
                    chat_id: msg.data.chat_id,
                    user_id: user_id,
                    text: msg.data.text,
                    nickname: nickname,
                    message_id: message.message_id
                }
            }, msg.data.chat_id, user_id, false);
        } else {
            this.send(websocketResponseDTO(msg, false, "Unknown_error"))
        }
    }

    async updateMessage(ws, user_id, msg) {
        let message = msg.message;

        let response = {
            chat_id: msg.data.chat_id,
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
            }, msg.data.chat_id, user_id, false)
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
                    chat_id: msg.data.chat_id,
                    message_id: deleteMessageReq.message_id
                }
            }, msg.data.chat_id, user_id, false);
        } else {
            this.send(websocketResponseDTO(msg, false, {}, "Unknown_error"))
        }
    }

    async clearChatHistory(ws, user_id, msg) {
        if (!msg.chat.is_ls && !msg.member.is_admin) {
            this.send(websocketResponseDTO(msg, false, {}, "Permission_denied"))
            return;
        }
        await MessagesModel.clearMessages(msg.data.chat_id);
        await brokerConnector.sendToAllChatMembers({
            type: "clearChatHistory",
            success: true,
            data: {
                chat_id: msg.data.chat_id
            }
        }, msg.data.chat_id, user_id, false)
    }

}


let localConnectionsCounter = 0;

wss.on('connection', (ws, req) => {

    ws.localConnection = ++localConnectionsCounter;
    console.log(`Connection established: awaiting accessToken`);

    let controller = new WebsocketController();

    controller.on('sendMessage',
        //new ChatDecorator(
        new MemberDecorator(
            new ChatTextDecorator(controller.createMessage.bind(controller)),
            false, true
        )
    //)
    )

    controller.on('updateMessage',
        //new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(
                new ChatTextDecorator(controller.updateMessage.bind(controller)), false),
            false, true
        )
    //)
    )

    controller.on('deleteMessage',
        //new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(controller.deleteMessage.bind(controller), true),
            false
        )
    //)
    );

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

