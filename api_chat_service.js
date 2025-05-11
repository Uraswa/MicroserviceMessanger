import dotenv from "dotenv"

dotenv.config();

import express from 'express'
import cors from 'cors'
import cookieParser from "cookie-parser";
import ChatsController from "./Controller/ChatsController.js";
import authMiddleware from "./middleware/auth-middleware.js";
import chatDecorator from "./middleware/chatDecorator.js";
import memberDecorator from "./middleware/memberDecorator.js";


const app = express()
app.use(express.json())
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:9000", // или true для любого origin
    credentials: true, // разрешаем куки и авторизационные заголовки
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(authMiddleware);

app.get('/api/getChats', ChatsController.getChats.bind(ChatsController));
app.get('/api/getChatInfo', ChatsController.getChatInfo.bind(ChatsController));
app.get('/api/joinChat', ChatsController.joinChat.bind(ChatsController));
app.get('/api/getOrCreateInvitationLink', ChatsController.getOrCreateInvitationLink.bind(ChatsController));
app.post('/api/leaveChat', chatDecorator, memberDecorator(false), ChatsController.leaveChat.bind(ChatsController));
app.post('/api/kickFromChat', chatDecorator, memberDecorator(true), ChatsController.kickFromChat.bind(ChatsController));
app.post('/api/updateChat', chatDecorator, memberDecorator(true), ChatsController.updateChat.bind(ChatsController));
app.post('/api/createChat', ChatsController.createChat.bind(ChatsController))
app.post('/api/deleteChat', chatDecorator, memberDecorator(false),ChatsController.deleteChat.bind(ChatsController))
app.post('/api/blockUnblockUserInChat', chatDecorator, memberDecorator(false),ChatsController.blockUnblockUserInChat.bind(ChatsController))

app.get('/api/getChatMembers', ChatsController.getChatMembers.bind(ChatsController))
app.get('/api/getChatMember', ChatsController.getChatMember.bind(ChatsController))
app.get('/api/getChatById', ChatsController.getChatById.bind(ChatsController))

app.listen(8000, () => {

})

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
});