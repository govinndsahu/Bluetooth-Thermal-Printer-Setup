import { printToPSF588 } from "./app.js";

console.log("Testing printToPSF588 API...");

printToPSF588({ id: "API-TEST-001" })
    .then(() => {
        console.log("✓ Print API test passed!");
        process.exit(0);
    })
    .catch((err) => {
        console.error("✗ Print API test failed:", err.message);
        process.exit(1);
    });
