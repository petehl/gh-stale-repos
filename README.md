# 🧊 gh-stale-repos

A CLI tool to find **stale and low-activity repositories** in a GitHub organization. Built with [Deno](https://deno.land/).

---

## 🚀 Features

- 📊 Finds repos with less than N commits and no recent updates
- 📄 Outputs results as colorized table, JSON, or CSV
- 📡 GitHub GraphQL API support

---

## 💻 Usage (CLI)

```bash
gh-stale-repos --org my-org-name --token ghp_abc123
