import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { readFileSync, readdirSync } from "fs";
// reuse the probe identity? We don't have it — the probe identity was random and not saved.
