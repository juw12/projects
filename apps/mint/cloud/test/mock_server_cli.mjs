// Runs the provider/push/email test doubles on :8799 for the browser e2e (node test/mock_server_cli.mjs).
import { startMockServices } from "./mock_services.mjs";

const port = parseInt(process.argv[2] || "8799", 10);
await startMockServices(port);
console.log("mock services on http://127.0.0.1:" + port);
