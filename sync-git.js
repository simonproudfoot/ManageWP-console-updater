const fetch = require('node-fetch');
require('dotenv').config();

// GitLab Configuration
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

// Notion Configuration
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_GIT_ID;
const NOTION_VERSION = '2022-06-28';

const formatDatabaseId = (id) => {
    return id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
};

const formattedDatabaseId = formatDatabaseId(NOTION_DATABASE_ID);

async function fetchGitLabRepos() {
    const baseUrl = 'https://gitlab.com/api/v4/projects?owned=true&simple=true&per_page=100'; // Fetch up to 100 per page
    let page = 1;
    let repos = [];
    let morePagesAvailable = true;

    try {
        while (morePagesAvailable) {
            const url = `${baseUrl}&page=${page}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${GITLAB_TOKEN}`
                }
            });

            if (!response.ok) {
                throw new Error(`GitLab API Error: ${response.statusText}`);
            }

            const data = await response.json();
            repos = repos.concat(data);

            // Check if more pages are available
            const totalPages = response.headers.get('x-total-pages');
            page += 1;

            morePagesAvailable = page <= totalPages;
        }

        // Get detailed repo info, including last commit
        const detailedRepos = [];
        for (const repo of repos) {
            const lastCommit = await fetchLastCommit(repo.id);
            detailedRepos.push({
                name: repo.name,
                url: repo.web_url,
                lastCommit: lastCommit?.created_at || 'No commits',
                lastCommitter: lastCommit?.committer_name || 'Unknown',
                lastCommitMessage: lastCommit?.message || 'No message'
            });
        }

        return detailedRepos;
    } catch (error) {
        console.error('Error fetching repositories from GitLab:', error.message);
        process.exit(1);
    }
}


async function fetchLastCommit(repoId) {
    const url = `https://gitlab.com/api/v4/projects/${repoId}/repository/commits?per_page=1`;

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${GITLAB_TOKEN}`
            }
        });

        if (!response.ok) {
            throw new Error(`GitLab API Error: ${response.statusText}`);
        }

        const commits = await response.json();
        return commits[0];
    } catch (error) {
        console.error(`Error fetching last commit for repo ${repoId}:`, error.message);
        return null;
    }
}

async function queryNotionDatabase(repoName) {
    const url = `https://api.notion.com/v1/databases/${formattedDatabaseId}/query`;

    const payload = {
        filter: {
            property: "Name",
            title: {
                equals: repoName
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Content-Type': 'application/json',
                'Notion-Version': NOTION_VERSION
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Notion API Error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.results;
    } catch (error) {
        console.error(`Error querying Notion database for ${repoName}:`, error.message);
        return null;
    }
}

async function updateNotionPage(pageId, repo) {
    const url = `https://api.notion.com/v1/pages/${pageId}`;

    const payload = {
        properties: {
            'Name': { title: [{ text: { content: repo.name } }] },
            'URL': { url: repo.url },
            'Last Commit': { date: { start: repo.lastCommit } },
            'Developer': { rich_text: [{ text: { content: repo.lastCommitter } }] }, // Set Developer
            'Comment': { rich_text: [{ text: { content: repo.lastCommitMessage } }] } // Set Commit Message
        }
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Content-Type': 'application/json',
                'Notion-Version': NOTION_VERSION
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Notion API Error: ${response.statusText}`);
        }

        console.log(`Successfully updated page for ${repo.name}`);
    } catch (error) {
        console.error(`Error updating Notion page for ${repo.name}:`, error.message);
    }
}

async function createNotionPage(repo) {
    const url = `https://api.notion.com/v1/pages`;

    const payload = {
        parent: { database_id: formattedDatabaseId },
        properties: {
            'Name': { title: [{ text: { content: repo.name } }] },
            'URL': { url: repo.url },
            'Last Commit': { date: { start: repo.lastCommit } },
            'Developer': { rich_text: [{ text: { content: repo.lastCommitter } }] }, // Set Developer
            'Comment': { rich_text: [{ text: { content: repo.lastCommitMessage } }] } // Set Commit Message
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Content-Type': 'application/json',
                'Notion-Version': NOTION_VERSION
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Notion API Error: ${response.statusText}`);
        }

        console.log(`Successfully created page for ${repo.name}`);
    } catch (error) {
        console.error(`Error creating Notion page for ${repo.name}:`, error.message);
    }
}

async function syncReposToNotion(repos) {
    for (const repo of repos) {
        const existingPages = await queryNotionDatabase(repo.name);

        if (existingPages && existingPages.length > 0) {
            console.log(`Updating existing entry for ${repo.name}`);
            await updateNotionPage(existingPages[0].id, repo);
        } else {
            console.log(`Creating new entry for ${repo.name}`);
            await createNotionPage(repo);
        }
    }
}

async function ensureNotionPropertiesExist() {
    const url = `https://api.notion.com/v1/databases/${formattedDatabaseId}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Notion-Version': NOTION_VERSION
            }
        });

        if (!response.ok) {
            throw new Error(`Notion API Error: ${response.statusText}`);
        }

        const database = await response.json();
        const existingProperties = database.properties;

        const requiredProperties = {
            'Name': { title: {} },
            'URL': { url: {} },
            'Last Commit': { date: {} },
            'Developer': { rich_text: {} }, // Ensure Developer is defined
            'Comment': { rich_text: {} } // Ensure Comment is defined
        };

        const updates = {};

        for (const [key, value] of Object.entries(requiredProperties)) {
            if (!existingProperties[key]) {
                updates[key] = value;
            }
        }

        if (Object.keys(updates).length > 0) {
            await updateNotionDatabaseSchema(updates);
        }
    } catch (error) {
        console.error('Error ensuring properties exist in Notion database:', error.message);
        process.exit(1);
    }
}

async function updateNotionDatabaseSchema(updates) {
    try {
        console.log('Forcibly updating database schema...');
        const response = await fetch(
            `https://api.notion.com/v1/databases/${formattedDatabaseId}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': NOTION_VERSION
                },
                body: JSON.stringify({ properties: updates })
            }
        );

        if (!response.ok) {
            throw new Error(`Notion API Error: ${response.statusText}`);
        }

        console.log('Database schema updated successfully');
        return await response.json();
    } catch (error) {
        console.error('Error updating database schema:', error.message);
        return null;
    }
}

async function main() {
    console.log('Ensuring necessary properties exist in Notion database...');
    await ensureNotionPropertiesExist();

    console.log('Fetching repositories from GitLab...');
    const repos = await fetchGitLabRepos();

    console.log('Syncing repositories to Notion database...');
    await syncReposToNotion(repos);

    console.log('Sync completed!');
}

main().catch(console.error);
