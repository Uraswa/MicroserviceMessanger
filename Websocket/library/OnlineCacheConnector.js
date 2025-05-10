import redis from "redis";

class OnlineCacheConnector {

    onlineCache;

    async init() {
        this.onlineCache = await redis.createClient()
            .on("error", (err) => console.log("Redis Client Error", err))
            .connect();
    }

    async clearOnlineCache(websocket_instance) {
        let prevConnections = await this.onlineCache.sMembers('ws' + websocket_instance);

        const pipeline = this.onlineCache.pipeline();

        for (let user_id of prevConnections) {
            pipeline.sRem('user_' + user_id.toString(), websocket_instance.toString())
        }

        pipeline.del('ws' + websocket_instance)

        await pipeline.exec();
    }

    async addUserToWs(websocket_instance, user_id){
        await Promise.all([
                        this.onlineCache.sAdd('user_' + user_id, websocket_instance.toString()),
                        this.onlineCache.sAdd('ws' + websocket_instance, user_id.toString())
                    ]
                )
    }

    async fullyRemoveUserFromWs(websocket_instance, user_id){
        await Promise.all([
                            this.onlineCache.sRem('user_' + user_id.toString(), websocket_instance.toString()),
                            this.onlineCache.sRem('ws' + websocket_instance, user_id.toString())
                        ]
                    )
    }

    async groupUsersByActiveWebsockets(users_ids, ignore_user_id = undefined) {
        const pipeline = this.onlineCache.pipeline();

        for (let user_id of users_ids) {
            if (user_id != ignore_user_id) pipeline.sMembers("user_" + user_id);
        }

        const pipelineResult = await pipeline.exec();

        let result = {};

        let index = 0;
        for (let [err, websockets] of pipelineResult) {
            if (err) continue;
            for (let ws of websockets) {

                if (!(ws in result)) {
                    result[ws] = new Set();
                }

                result[ws].add(Number.parseInt(users_ids[index]))

            }

            index++;
        }

        return result;
    }

}

const connector = new OnlineCacheConnector();
await connector.init();

export default connector;