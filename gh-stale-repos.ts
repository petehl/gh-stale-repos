#!/usr/bin/env -S deno run --allow-net --allow-env

import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";
import { Table } from "https://deno.land/x/cliffy@v1.0.0-rc.4/table/mod.ts";
import {
  format,
  isBefore,
  parseISO,
  subDays,
} from "https://cdn.skypack.dev/date-fns@v4.1.0";

const { options } = await new Command()
  .name("gh-stale-repos")
  .version("1.0.0")
  .description(
    "Find non archived GitHub repositories in an organization that are stale and have low commit counts.",
  )
  .option("-o, --org <org:string>", "GitHub organization to scan", {
    required: true,
  })
  .option(
    "-t, --token <token:string>",
    "GitHub token (or set GH_SR_TOKEN env var)",
    { default: Deno.env.get("GH_SR_TOKEN") },
  )
  .option(
    "-c, --commit-threshold <threshold:number>",
    "Max commits to consider 'low activity'",
    { default: 20 },
  )
  .option(
    "-d, --stale-days <days:number>",
    "Consider repos stale after this many days",
    { default: 180 },
  )
  .option("--json", "Output as JSON")
  .option("--csv <file:string>", "Write results to a CSV file")
  .parse(Deno.args);

const { org, token, commitThreshold, staleDays } = options;

if (!token) {
  console.error(
    "❌ GitHub token is required. Pass with --token or set GH_SR_TOKEN env var.",
  );
  Deno.exit(1);
}

console.log(token);

const API_URL = "https://api.github.com/graphql";
const cutoffDate = subDays(new Date(), staleDays);
const headers = {
  "Authorization": `Bearer ${token}`,
  "Content-Type": "application/json",
};

const query = `
query ($org: String!, $cursor: String) {
  organization(login: $org) {
    repositories(first: 100, after: $cursor, isArchived: false, orderBy: {field: PUSHED_AT, direction: ASC}) {
      nodes {
        name
        pushedAt
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 1) {
                totalCount
                nodes {
                  committedDate
                  author {
                    name
                    email
                    user {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}
`;

async function fetchStaleRepos() {
  let cursor: string | null = null;
  const staleRepos: Array<
    {
      name: string;
      commits: number;
      pushedAt: string;
      lastCommitDate: string;
      lastCommitAuthor: string;
      lastCommitAuthorEmail: string;
    }
  > = [];

  while (true) {
    // deno-lint-ignore no-explicit-any
    const res: any = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { org, cursor } }),
    });

    if (!res.ok) {
      console.error("❌ GitHub API error:", await res.text());
      Deno.exit(1);
    }

    const data = await res.json();
    const repos = data.data.organization.repositories;

    for (const repo of repos.nodes) {
      const pushedAt = parseISO(repo.pushedAt);
      const isStale = isBefore(pushedAt, cutoffDate);
      const history = repo.defaultBranchRef?.target?.history;
      const lastCommitInfo = history?.nodes?.[0];
      const lastCommitDate = lastCommitInfo?.committedDate || pushedAt;

      const author = lastCommitInfo?.author?.user?.login ||
        lastCommitInfo?.author?.name ||
        "unknown";

      const authorEmail = lastCommitInfo?.author?.email ||
        "unknown";

      const totalCommits = repo.defaultBranchRef?.target?.history?.totalCount ||
        0;
      if (isStale && totalCommits < commitThreshold) {
        staleRepos.push({
          name: repo.name,
          pushedAt: format(pushedAt, "yyyy-MM-dd"),
          commits: totalCommits,
          lastCommitDate: format(
            new Date(lastCommitDate),
            "yyyy-MM-dd",
          ),
          lastCommitAuthor: author,
          lastCommitAuthorEmail: authorEmail,
        });
      }
    }

    if (!repos.pageInfo.hasNextPage) break;
    cursor = repos.pageInfo.endCursor;
  }

  return staleRepos;
}

console.log(
  `🔍 Scanning "${org}" for repos not updated in ${staleDays} days with < ${commitThreshold} commits...\n`,
);
const results = await fetchStaleRepos();

if (results.length === 0) {
  console.log("✅ No stale, low-activity repos found!");
  Deno.exit(0);
}

if (results.length === 0) {
  console.log("✅ No stale, low-activity repos found!");
}

if (options.json) {
  console.log(JSON.stringify(results, null, 2));
} else if (options.csv) {
  const file = options.csv;
  const lines = ["Repo,Commits,Last Updated,Last Commit,Author,Author Email"];
  for (const r of results) {
    lines.push(
      `${r.name},${r.commits},${r.pushedAt},${r.lastCommitDate},${r.lastCommitAuthor},${r.lastCommitAuthorEmail}`,
    );
  }
  await Deno.writeTextFile(options.csv, lines.join("\n"));
  console.log(`📄 CSV saved to ${file}`);
} else {
  new Table()
    .header(["Repo", "Commits", "Last Pushed"])
    .body(results.map((r) => [
      `\x1b[36m${r.name}\x1b[0m`,
      r.commits,
      r.pushedAt,
    ]))
    .border()
    .render();
}
