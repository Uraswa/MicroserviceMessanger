import dotenv from "dotenv"

dotenv.config();

import {WebSocketServer} from "ws";
import tokenService from "../services/tokenService.js";
import CacheConnector from "./library/OnlineCacheConnector.js";
import onlineCacheConnector from "./library/OnlineCacheConnector.js";
import RabbitMQBrokerConnector from "./library/brokers/RabbitMQBrokerConnector.js";


const websocket_instance = Number.parseInt(process.argv[2]) - 1;
let port = 8080 + websocket_instance;
console.log("RUNNING ON PORT", port)

await onlineCacheConnector.clearOnlineCache(websocket_instance);

const brokerConnector = RabbitMQBrokerConnector;
await brokerConnector.initPublisher();

await setupRedisSubscriptions();

const clients = new Map();


const wss = new WebSocketServer({port: port});


let localConnectionsCounter = 0;

wss.on('connection', (ws, req) => {

    ws.localConnection = ++localConnectionsCounter;
    console.log(`Connection established: awaiting accessToken`);

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

            }
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

                        if (userConnection.ws === null || userConnection.is_disconnected) continue;

                        if (!tokenService.validateAccessToken(accessToken)) {
                            userConnection.is_disconnected = true;
                            console.log(`Disconnecting user ${user_id}: not authorized`);
                            ws.close(4001, "Not_authorized");
                            continue;
                        }

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
    process.exit(0);
});

