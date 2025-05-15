import dotenv from "dotenv"
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import authMiddleware from "./middleware/auth-middleware.js";
import MessagesSearcherController from "./Controller/MessagesSearcherController.js";
import ChatDecorator from "./middleware/chatDecorator.js";
import MemberDecorator from "./middleware/memberDecorator.js";
import ChatTextDecorator from "./middleware/chatTextDecorator.js";
import MessagesPublisherController from "./Controller/MessagesPublisherController.js";
import MessageAccessDecorator from "./middleware/messageAccessDecorator.js";

dotenv.config();
const app = express()
app.use(express.json())
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:9000", // или true для любого origin
    credentials: true, // разрешаем куки и авторизационные заголовки
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(authMiddleware);
app.disable('etag');

app.get('/api/getMessages', MessagesSearcherController.getMessages.bind(MessagesSearcherController));
app.get('/api/getLastChatMessage', MessagesSearcherController.getLastMessage.bind(MessagesSearcherController));
app.post('/api/getLastMessageByChat', MessagesSearcherController.getLastMessageByChat.bind(MessagesSearcherController));

app.post('/api/sendMessage',
    ChatDecorator(),
    MemberDecorator(false, true),
    ChatTextDecorator,
    MessagesPublisherController.createMessage.bind(MessagesPublisherController)
)

app.post('/api/updateMessage',
    ChatDecorator(),
    MemberDecorator(false, true),
    ChatTextDecorator,
    MessageAccessDecorator(false),
    MessagesPublisherController.updateMessage.bind(MessagesPublisherController)
)

app.post('/api/deleteMessage',
    MemberDecorator(false, false),
    MessageAccessDecorator(true),
    MessagesPublisherController.deleteMessage.bind(MessagesPublisherController)
)

app.post('/api/clearChatHistory',
    ChatDecorator(),
    MemberDecorator(false),
    MessagesPublisherController.clearMessages.bind(MessagesPublisherController)
)

app.listen(8003, () => {
    console.log("messages service started!")
})