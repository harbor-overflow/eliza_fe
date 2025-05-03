# Harbor: AI Agent Memory Hub

## 🚨 Problem

AI models have evolved rapidly — but their **memory and ownership infrastructure** hasn’t.

- AI agents lack **persistent memory**: every task resets context.
- Outdated training data can result in **inaccurate responses**.
- There’s no **proper way to store, share, or evolve** agent-level knowledge.

---

## 🔍 Scenario

---

## 💡 Solution

**Harbor** is a decentralized AI Agent Memory Hub.

With Harbor, users can:

1. **Store persistent agent memory** — and evolve it over time.
2. **Buy, sell, or share** AI memories as programmable IP.

---

## 🧱 Architecture

Harbor consists of the following core components:

### Memory Layer

- Powered by **Walrus** for long-term memory persistence
- Built-in support for **Seal** — decentralized access control

---

## 🔜 Roadmap

Here’s what’s coming next:

# how to test

you must set up the `.env` file in `eliza`

in `eliza` use bun

```bash
bun install
bun run build
bun start
```

go to `localhost:3000` and you should see the `eliza` interface

Toggle the switch in the top-right corner to test the functionality that exports and imports memory encrypted using Walurs and Seal
