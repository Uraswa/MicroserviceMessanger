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

        const pipeline = [];

        for (let user_id of prevConnections) {
            pipeline.push(this.onlineCache.sRem('user_' + user_id.toString(), websocket_instance.toString()))
        }

        pipeline.push(this.onlineCache.del('ws' + websocket_instance))

        await Promise.all(pipeline);
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
        const pipeline = [];

        for (let user_id of users_ids) {
            if (user_id != ignore_user_id) pipeline.push(this.onlineCache.sMembers("user_" + user_id));
        }

        const pipelineResult = await Promise.all(pipeline);

        let result = {};

        let index = 0;
        for (let websockets of pipelineResult) {

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