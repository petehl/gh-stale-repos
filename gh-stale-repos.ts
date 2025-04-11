#!/usr/bin/env -S deno run --allow-net --allow-env

import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts";
import { Table } from "https://deno.land/x/cliffy@v1.0.0-rc.4/table/mod.ts";
import { parseISO, isBefore, subDays, format } from "https://cdn.skypack.dev/date-fns@v4.1.0";
import { writeCSV } from "https://deno.land/x/csv@v0.9.2/mod.ts";

const { options } = await new Command()
  .name("gh-stale-repos")
  .version("1.0.0")
  .description("Find non archived GitHub repositories in an organization that are stale and have low commit counts.")
  .option("-o, --org <org:string>", "GitHub organization to scan", { required: true })
  .option("-t, --token <token:string>", "GitHub token (or set GH_SR_TOKEN env var)", { default: Deno.env.get("GH_SR_TOKEN") })
  .option("-c, --commit-threshold <threshold:number>", "Max commits to consider 'low activity'", { default: 20 })
  .option("-d, --stale-days <days:number>", "Consider repos stale after this many days", { default: 180 })
  .option("--json", "Output as JSON")
  .option("--csv <file:string>", "Write results to a CSV file")
  .parse(Deno.args);

const { org, token, commitThreshold, staleDays } = options;

if (!token) {
  console.error("❌ GitHub token is required. Pass with --token or set GH_SR_TOKEN env var.");
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
              history {
                totalCount
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
  const staleRepos: Array<{ name: string; commits: number; pushedAt: string }> = [];

  while (true) {
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
      const commits = repo.defaultBranchRef?.target?.history?.totalCount || 0;
      if (isStale && commits < commitThreshold) {
        staleRepos.push({
          name: repo.name,
          pushedAt: format(pushedAt, "yyyy-MM-dd"),
          commits,
        });
      }
    }

    if (!repos.pageInfo.hasNextPage) break;
    cursor = repos.pageInfo.endCursor;
  }

  return staleRepos;
}

console.log(`🔍 Scanning "${org}" for repos not updated in ${staleDays} days with < ${commitThreshold} commits...\n`);
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
    const csvData: any = results.map(r => ({
      name: r.name,
      commits: r.commits,
      pushedAt: r.pushedAt,
    }));
    const writer = await Deno.open(file, { write: true, create: true, truncate: true });
    await writeCSV(writer, csvData);
    writer.close();
    console.log(`📄 CSV saved to ${file}`);
  } else {
    new Table()
      .header(["Repo", "Commits", "Last Pushed"])
      .body(results.map(r => [
        `\x1b[36m${r.name}\x1b[0m`, r.commits, r.pushedAt,
      ]))
      .border()
      .render();
  }
