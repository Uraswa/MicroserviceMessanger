import dotenv from "dotenv"
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import authMiddleware from "./middleware/auth-middleware.js";
import MessagesSearcherController from "./Controller/MessagesSearcherController.js";

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

app.get('/api/getMessages', MessagesSearcherController.getMessages.bind(MessagesSearcherController));
app.get('/api/getLastChatMessage', MessagesSearcherController.getLastMessage.bind(MessagesSearcherController));
app.get('/api/getLastMessageByChat', MessagesSearcherController.getLastMessageByChat.bind(MessagesSearcherController));

app.listen(8003, () => {

})