const WebSocket = require('ws');
const redis = require('redis');

const model = require('db');

async function getChatParticipants(chatId) {

    if (chatId === '1') {
        return ['user1', 'user2', 'user3'];
    } else if (chatId === '2') {
        return ['user4', 'user5'];
    }
    return ['user1', 'user2'];
}

const redisClient = redis.createClient({
    url: 'redis://localhost:6379'
});

const redisPublisher = redisClient.duplicate();
const redisSubscriber = redisClient.duplicate();

const clients = new Map();

// WebSocket server
const server = app.listen(8080, async () => {
    try {
        await Promise.all([
            redisClient.connect(),
            redisPublisher.connect(),
            redisSubscriber.connect()
        ]);

        // Subscribe to Redis channels for all users
        await setupRedisSubscriptions();

        console.log('Server started on port 8080 with Redis connected');
    } catch (err) {
        console.error('Failed to connect to Redis:', err);
        process.exit(1);
    }
});

const wss = new WebSocket.Server({server});


class WebsocketController {

    routes = new Map();
    userId;
    ws;

    async route(ws, userId, msg) {
        let type = msg.type;
        if (this.routes.has(type)) {
            this.ws = ws;
            let controller = this.routes.get(type);
            await controller.call(ws, userId, msg);
        }
    }

    on(route, callback) {
        this.routes.set(route, new WebsocketDecorator(callback))
    }

    send(msg) {
        this.ws.send(JSON.stringify(msg));
    }


    async createMessage(ws, userId, msg) {
        let message = await model.createMessage(msg.chatId, userId, msg.text);

        if (message && message.message_id) {
            await sendToAllChatMembers({
                type: "createMessage",
                success: true,
                data: {
                    chatId: msg.chat.chat_id,
                    userId: userId,
                    text: msg.text,
                    messageId: message.message_id
                }
            }, msg.chatId, userId, false);
        } else {
            this.send({type: "createMessageResp", success: false, error: "Unknown_error"})
        }
    }

    async updateMessage(ws, userId, msg) {
        let message = msg.message;

        let response = {
            chatId: msg.chat.chat_id,
            messageId: message.message_id,
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
            }, msg.chat.chat_id, userId, false)
        } else {
            ws.send(JSON.stringify({type: "updateMessageResp", success: false, error: "Unknown_error"}));
        }

    }

    async deleteMessage(ws, userId, msg) {
        let deleteMessageReq = await model.deleteMessage(msg.data.messagId)
        if (deleteMessageReq) {
            await sendToAllChatMembers({
                type: "deleteMessage",
                success: true,
                data: {
                    chatId: chatId,
                    messageId: deleteMessageReq.message_id
                }
            }, msg.data.chat.chat_id, userId, false);
        } else {
            ws.send(JSON.stringify({type: "deleteMessageResp", success: false, error: "Unknown_error"}));
        }
    }

    async joinChatByLink(ws, userId, msg) {
        let joinRes = await model.joinChatByInviteLink(userId, msg.data.link);
        if (joinRes.error) {
            ws.send(JSON.stringify({type: "chatMemberJoinedResp", success: false, error: "Unknown_error"}));
        } else if (joinRes.joined) {
            let chat = await model.getChatById(joinRes.chat_id);
            await sendToAllChatMembers({
                type: "chatMemberJoined",
                success: true,
                data: {
                    chatId: chat.chat_id,
                    userUd: userId
                }
            }, msg.data.chat.chat_id, userId, false);
            ws.send(JSON.stringify({type: "chatMemberJoinedResp", success: true, chatId: chat.chat_id}));
        }
    }

    async leaveChat(ws, userId, msg) {
        let leaveChatResult = await model.leaveChat(userId, msg.data.chatId);
        if (leaveChatResult) {
            await sendToAllChatMembers({
                type: "chatMemberLeaved",
                success: true,
                data: {
                    chatId: msg.data.chatId,
                    userUd: userId
                }
            }, msg.data.chat.chat_id, userId, false);
        } else {
            ws.send(JSON.stringify({type: "chatMemberLeavedResp", success: false, error: "Unknown_error"}));
        }
    }

    async kickFromChat(ws, userId, msg) {
        if (msg.userId === userId) {
            ws.send(JSON.stringify({type: "chatMemberKickResp", success: false, error: "Self_kick_error"}));
            return;
        }

        let kickResult = await model.leaveChat(msg.data.userId, msg.data.chatId);
        if (kickResult) {
            await sendToAllChatMembers({
                type: "chatMemberLeaved",
                success: true,
                data: {
                    chatId: msg.data.chatId,
                    userUd: userId
                }
            }, msg.data.chat.chat_id, userId, false);
            return;
        }

        ws.send(JSON.stringify({type: "chatMemberKickResp", success: false, error: "Unknown_error"}));
    }

    async getInviteLink(ws, userId, msg) {
        let inviteLink = await model.getOrCreateInvitationLink(msg.chatId, userId);
        if (!inviteLink) {
            ws.send(JSON.stringify({type: "getInviteLinkResp", success: false, error: "Unknown_error"}));
            return;
        }

        ws.send(JSON.stringify({type: "getInviteLinkResp", success: true, data: {inviteLink}}));
    }

    async createChat(ws, userUd, msg) {
        let {chatName, is_ls, otherUserId} = msg.data;
        if (is_ls) {
            let otherUser = await model.getUserById(otherUserId);

            if (!otherUser) {
                ws.send(JSON.stringify({type: "createChatResp", success: false, error: "User_not_exist"}));
                return;
            }

            let privateChatRes = await model.createPrivateChat(userUd, otherUserId)
            if (privateChatRes) {
                let promise1 = sendToExactMember({
                    type: "createChat",
                    success: true,
                    data: {
                        chatId: privateChatRes.chat_id,
                        is_ls: true,
                        chatName: `Чат с ${userUd}`
                    }
                }, otherUserId);
                let promise2 = sendToExactMember({
                    type: "createChat",
                    success: true,
                    data: {
                        chatId: privateChatRes.chat_id,
                        is_ls: true,
                        chatName: `Чат с ${otherUserId}`
                    }
                }, userUd);

                await promise1;
                await promise2;


            } else {

            }
        } else {
            if (!chatName || chatName.length > 40) {
                ws.send(JSON.stringify({
                    success: false,
                    type: "createChatResp",
                    error_field: "chatName",
                    error: "Название чата не д.б. пустым или больше 40 символов!"
                }));
                return;
            }

            let result = await model.createGroupChat(userUd, chatName);
            if (result) {
                ws.send(JSON.stringify({
                    success: true,
                    type: "createChat",
                    data: {
                        chatId: result.chat_id,
                        chatName: chatName,
                        is_ls: false
                    }
                }));
            } else {
                ws.send(JSON.stringify({type: "createChatResp",success: false, error: "Unknown_error"}));
            }
        }

    }

    async updateChat(ws, userId, msg) {
        let newChatName = msg.data.chatName;

        if (msg.chat.is_ls) {
            ws.send(JSON.stringify({success: false, error: "Permission_denied"}));
            return;
        }

        if (!newChatName || newChatName.length > 40) {
            ws.send(JSON.stringify({
                success: false,
                type: "updateChatResp",
                error_field: "chatName",
                error: "Название чата не д.б. пустым или больше 40 символов!"
            }));
            return;
        }

        let result = await model.updateGroupChat(msg.chat.chat_id, newChatName);
        if (result) {
            await sendToAllChatMembers({
                type: "updateChat",
                success: true,
                data: {
                    chatId: msg.chat.chat_id,
                    chatName: newChatName
                }
            }, msg.chat.chat_id, userId, false)
            return;
        }

        ws.send(JSON.stringify({type: "updateChatResp", success: false, error: "Unknown_error"}));

    }

    async deleteChat(ws, userId, msg) {
        let result = await model.deleteGroupChat(msg.chat.chat_id, userId);
        if (result) {
            await sendToAllChatMembers({
                type: "deleteChat",
                success: true,
                data: {
                    chatId: msg.chat.chat_id
                }
            }, msg.chat.chat_id, userId, false)
            return;
        }

        ws.send(JSON.stringify({type: "deleteChatResp",success: false, error: "Unknown_error"}));
    }

}

class WebsocketDecorator {
    _callback;

    constructor(callback) {
        this._callback = callback;
    }

    async call(ws, userId, msg) {
        if (typeof (this._callback) === "function") {
            await this._callback(ws, userId, msg);
        } else {
            await this._callback.callback(ws, userId, msg)
        }
    }

    async callback(ws, userId, msg) {

    }
}

class ChatDecorator extends WebsocketDecorator {

    async callback(ws, userId, msg) {
        let chatId = msg.data.chatId;
        let chat = await model.getChatById(chatId);

        if (!chat) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Chat_not_exist"}));
        } else {
            msg.chat = chat;
            await this.call(ws, userId, msg)
        }
    }
}

class MemberDecorator extends WebsocketDecorator {

    constructor(callback, adminRequired) {
        super(callback);

        this.adminRequired = adminRequired;
    }

    async callback(ws, userId, msg) {

        let member = await model.getChatMember(msg.data.chatId, userId);
        if (!member || !member.is_admin && this.adminRequired) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Permission_denied"}));
            return;
        }

        msg.member = member;

        await this.call(ws, userId, msg);
    }

}

class ChatTextDecorator extends WebsocketDecorator {
    async callback(ws, userId, msg) {

        let text = msg.data.text;
        if (!text || text.length > 256) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Message_len"}));
            return;
        }

        await this.call(ws, userId, msg);
    }
}

class MessageAccessDecorator extends WebsocketDecorator {

    constructor(callback, isAdminActionAvailable) {
        super(callback);

        this.isAdminActionAvailable = isAdminActionAvailable;
    }

    async callback(ws, userId, msg) {

        let message = await model.getMessageById(msg.data.messagId);
        if (!message) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Message_not_exist"}));
            return;
        }

        if (message.user_id !== userId && (!this.isAdminActionAvailable || this.isAdminActionAvailable && !msg.member.is_admin)) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Permission_denied"}));
            return;
        }

        msg.message = message;

        await this.call(ws, userId, msg);
    }
}

async function sendToAllChatMembers(msg, chatId, senderId, exemptSender = true) {

    const participants = await getChatParticipants(chatId);


    for (const participantId of participants) {
        if (participantId === senderId && !exemptSender || participantId !== senderId) {
            const redisMessage = JSON.stringify({
                ...msg,
                recipient_id: participantId,
                timestamp: new Date().toISOString()
            });

            await redisPublisher.publish(
                `user:${participantId}`,
                redisMessage
            );
        }
    }
}

async function sendToExactMember(msg, receiverId) {

    const redisMessage = JSON.stringify({
                ...msg,
                recipient_id: receiverId,
                timestamp: new Date().toISOString()
            });

    await redisPublisher.publish(
        `user:${receiverId}`,
        redisMessage
    );
}

wss.on('connection', (ws, req) => {

    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');

    if (!userId) {
        ws.close(4001, 'User ID required');
        return;
    }

    console.log(`User connected: ${userId}`);

    if (!clients.has(userId)) {
        clients.set(userId, []);
    }
    clients.get(userId).push(ws);

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

    controller.on('deleteMessage', new ChatDecorator(
        new MemberDecorator(
            new MessageAccessDecorator(controller.deleteMessage, true),
            false
        )
    ))

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
            await controller.route(ws, userId, message);
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });


    ws.on('close', () => {
        const userWs = clients.get(userId);
        if (userWs) {
            const index = userWs.indexOf(ws);
            if (index > -1) {
                userWs.splice(index, 1);
            }
            if (userWs.length === 0) {
                clients.delete(userId);
            }
        }
        console.log(`User disconnected: ${userId}`);
    });
});

async function setupRedisSubscriptions() {
    redisSubscriber.on('message', (channel, message) => {
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

    // In a real app, you might want dynamic subscription management
    // For this example, we'll subscribe to a pattern that matches all user channels
    await redisSubscriber.pSubscribe('user:*');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    await redisClient.quit();
    await redisPublisher.quit();
    await redisSubscriber.quit();
    process.exit(0);
});

