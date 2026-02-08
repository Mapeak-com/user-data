import { app } from './app.js';
import * as elasticGateway from './elastic.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server starting on port ${PORT}`);
    await elasticGateway.initialize();
    console.log(`Server started on port ${PORT}`);
});

process.on('SIGINT', function () {
    console.log("Gracefully shutting down from SIGINT (Ctrl-C)");
    process.exit();
});