import * as model from './db.js'
import express from 'express'
import cors from 'cors'
import {sendToAllChatMembers, sendToExactMember, getChatParticipants} from "./brokerConnector.js";
import tokenService from "./services/tokenService.js";
import cookieParser from "cookie-parser";
import InnerCommunicationService from "./services/innerCommunicationService.js";

const app = express()
app.use(express.json())
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:9000", // или true для любого origin
  credentials: true, // разрешаем куки и авторизационные заголовки
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.get('/health', (req, res) => res.status(200).send('OK'));


function auth(req) {

    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader) {
        return false;
    }

    const accessToken = authorizationHeader.split(' ')[1];
    if (!accessToken) {
        return false;
    }

    const userData = tokenService.validateAccessToken(accessToken);
    if (!userData) {
        return false;
    }

    return userData;
}

function not_auth(res) {
    return res.status(401).json({
        success: false,
        error: "Not_authorized"
    });
}

async function getProfile(user_id) {
    //let response = await axios.get(`http://localhost:8001/api/getProfile?user_id=${user_id}`);
    let response = await InnerCommunicationService.get(`/api/getProfile?user_id=${user_id}`, 8001);
    if (response.status === 200) {
        return response.data.data;
    } else {
        return undefined;
    }
}

// Эндпоинты
app.get('/api/getChats', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        let filters = {}
        if (req.query.filters) {
            filters = JSON.parse(req.query.filters)
        }

        const chats = await model.getChats(user.user_id, filters);

        let usersIds = new Set();
        let chatsMap = new Map();
        let shards = new Map();

        for (let chat of chats) {
            let shard = model.getShard(chat.chat_id)
            if (!shards.has(shard.name)){
                shards.set(shard.name, []);
            }

            chat.last_message_timestamp = chat.created_time;

            shards.get(shard.name).push(chat.chat_id);
            chatsMap[chat.chat_id] = chat;

        }

        for (const [shard, chatIds] of shards){
            let messages = await model.getLastMessagesFromSameShard(chatIds);
            for (let msg of messages){
                let chat = chatsMap[msg.chat_id];
                chat.last_message_id = msg.message_id;
                chat.last_message_text = msg.text;
                chat.last_message_user_id = msg.user_id;
                chat.last_message_timestamp = msg.timestamp;
            }
        }


        for (let chat of chats) {
            if (chat.last_message_user_id) usersIds.add(chat.last_message_user_id);
            if (chat.other_user_id) usersIds.add(chat.other_user_id);
        }

        let userProfiles = [];
        if (usersIds.size) {
            //let result = await axios.get(`http://localhost:8001/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from(usersIds))}`)
            let result = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from(usersIds))}`, 8001)
            userProfiles = result.data.data.profiles;
        }

        res.status(200).json({
            success: true,
            data: {chats, userProfiles}
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/getLastChatMessage', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {chat_id} = req.query;

        if (!await model.getChatMember(chat_id, user.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'access denied'
            });
        }

        let msg = await model.getLastChatMessage(chat_id);
        if (!msg) {
            return res.status(200).json({
                success: true,
                data: {
                    msg: null
                }
            });
        }

        let result = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from([msg.user_id]))}`, 8001)
        let userProfiles = result.data.data.profiles;

        return res.status(200).json({
            success: true,
            data: {
                msg: msg,
                profile: userProfiles ? userProfiles[0] : null
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


app.get('/joinChat', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {

        let chat_id = await model.getChatIdByInviteLink(req.query.link);

        if (!chat_id) {
            return res.status(404).json({
                success: false,
                error: "Чат не найден"
            });
        }

        let chat = await model.getChatById(chat_id);
        if (!chat) {
            return res.status(404).json({
                success: false,
                error: "Чат не найден"
            });
        }

        let member = await model.getChatMember(chat_id, user.user_id, false);
        if (member) {
            return res.status(200).json({
                success: true
            });
        }

        let joinRes = await model.joinChatByInviteLink(user.user_id, req.query.link);
        if (joinRes.error) {
            return res.status(500).json({
                success: false,
                error: "Чат не найден"
            });
        } else if (joinRes.joined) {
            let profile = await getProfile(user.user_id);

            if (!profile) {
                return res.status(500).json({
                    success: false,
                    error: "Произошла ошибка"
                });
            }

            await sendToAllChatMembers({
                type: "chatMemberJoined",
                success: true,
                data: {
                    chat_id: chat.chat_id,
                    user_id: user.user_id,
                    nickname: profile.nickname
                }
            }, chat.chat_id, user.user_id, false);
            return res.status(200).json({
                success: true
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }

})

app.get('/api/getOrCreateInvitationLink', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {chat_id} = req.query;
        if (!chat_id) {
            return res.status(400).json({
                success: false,
                error: 'chat_id is required'
            });
        }

        if (!await model.getChatMember(chat_id, user.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'access denied'
            });
        }

        let inviteLink = await model.getOrCreateInvitationLink(chat_id, user.user_id);

        if (!inviteLink) {
            return res.status(400).json({
                success: false,
                error: 'Unknown_error'
            });
        }

        inviteLink = "http://localhost:9000/joinChat/" + inviteLink;

        res.status(200).json({
            success: true,
            data: {
                link: inviteLink
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/getMessages', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        const {chat_id, limit = 50, last_message_id = 2228} = req.query;
        if (!chat_id) {
            return res.status(400).json({
                success: false,
                error: 'chat_id is required'
            });
        }

        if (!await model.getChatMember(chat_id, user.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'access denied'
            });
        }

        const messages = await model.getMessages(chat_id, last_message_id)

        res.status(200).json({
            success: true,
            data: messages
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/getChatInfo', async (req, res) => {
    const user = auth(req);
    if (!user) return not_auth(res);

    try {
        let {chat_id, last_message_id = undefined, other_user_id} = req.query;


        if (!chat_id && !other_user_id) {
            return res.status(400).json({
                success: false,
                error: 'chat_id or other_user_id is required'
            });
        }

        if (other_user_id) {
            let getRes = await model.getChatByOtherUserId(user.user_id, other_user_id);
            if (!getRes) {
                return res.status(200).json({
                    success: false,
                    error: 'chat_not_found'
                });
            }
            chat_id = getRes.chat_id;
        }


        let chat = await model.getChatById(chat_id);
        if (!chat) {
            return res.status(400).json({
                success: false,
                error: 'chat_not_exists'
            });
        }

        let chat_name = chat.chat_name;
        let is_ls = chat.is_ls;

        if (!await model.getChatMember(chat_id, user.user_id)) {
            return res.status(403).json({
                success: false,
                error: 'access denied'
            });
        }

        const messagesReq = model.getMessages(chat_id, last_message_id);
        const members = await model.getChatMembers(chat_id);

        let messages = await messagesReq;

        let userIds = new Set();
        for (let message of messages) {
            userIds.add(message.user_id);
        }

        for (let member of members) {
            userIds.add(member.user_id)
        }

        let profiles = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from(userIds))}`, 8001)

        let userProfiles = profiles.data.data.profiles;

        res.status(200).json({
            success: true,
            data: {messages, userProfiles, members, chat_name, is_ls, chat_id}
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
})


app.listen(8000, () => {

})

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close();
});