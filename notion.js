const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// Virtualmin Configuration
const config = {
    username: process.env.LIVE_SERVER_USERNAME,
    password: process.env.LIVE_SERVER_PASSWORD,
    server: process.env.SERVER_IP,
    port: 10000
};

const virtualminUrl = `https://${config.server}:${config.port}/virtual-server/remote.cgi`;

// Notion Configuration
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// MainWP Configuration
const MAINWP_DASHBOARD_URL = process.env.MAINWP_DASHBOARD_URL;
const CONSUMER_KEY = process.env.WP_MANAGE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WP_MANAGE_SECRET_KEY;

const formatDatabaseId = (id) => {
    return id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
};

const formattedDatabaseId = formatDatabaseId(NOTION_DATABASE_ID);

async function fetchDomains() {
    try {
        const response = await axios({
            method: 'get',
            url: virtualminUrl,
            params: {
                program: 'list-domains',
                json: 1
            },
            auth: {
                username: config.username,
                password: config.password
            },
            httpsAgent: new (require('https').Agent)({
                rejectUnauthorized: false
            })
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching domains:', error.message);
        process.exit(1);
    }
}

function processDomains(data) {
    return data.data
        .filter(item => item.name && item.name.trim() !== '' && !item.name.includes('----'))
        .map(item => ({
            domain: item.name.split(/\s+/)[0],
            url: `https://${item.name.split(/\s+/)[0]}`
        }))
        .filter(item => item.domain !== 'Domain');
}

async function fetchSiteDetails(url) {
    const sitesEndpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/sites/get-sites-by-url`;
    try {
        console.log(`Fetching details for ${url} from MainWP...`);
        const response = await axios.get(sitesEndpoint, {
            params: {
                consumer_key: CONSUMER_KEY,
                consumer_secret: CONSUMER_SECRET,
                urls: url
            }
        });

        console.log('MainWP API Response:', JSON.stringify(response.data, null, 2));

        const sites = response.data;
        if (typeof sites === 'object' && sites !== null && Object.keys(sites).length > 0) {
            const siteId = Object.keys(sites)[0];
            const site = sites[siteId];
            return processSiteDetails(site, true);
        } else {
            console.log(`${url} not found in WP manage`);
            return processSiteDetails(null, false);
        }
    } catch (error) {
        console.error(`Error fetching details for ${url}:`, error.message);
        return processSiteDetails(null, false);
    }
}

function processSiteDetails(site, foundInMainWP) {
    if (!foundInMainWP) {
        return {
            'Domain': '',
            'Site URL': '',
            'Number of Security Issues': 0,
            'Site Health Score': 0,
            'Core Update Available': ['No'],
            'Number of Plugin Updates': 0,
            'PHP Version': 'Unknown',
            'Maintenance': ['No']
        };
    }

    console.log('Processing site details:', JSON.stringify(site, null, 2));

    const pluginUpdates = JSON.parse(site.plugin_upgrades || '{}');
    const pluginUpdateCount = Object.keys(pluginUpdates).length;
    const wpUpgrades = JSON.parse(site.wp_upgrades || '[]');
    const hasCoreUpdate = wpUpgrades.length > 0;

    let siteInfo = {};
    try {
        siteInfo = JSON.parse(site.site_info || '{}');
    } catch (error) {
        console.error(`Error parsing site_info for ${site.name}:`, error.message);
    }

    const processedDetails = {
        'Domain': site.name,
        'Site URL': site.url,
        'Number of Security Issues': parseInt(site.securityIssues) || 0,
        'Site Health Score': parseInt(site.health_value) || 0,
        'Core Update Available': [hasCoreUpdate ? 'Yes' : 'No'],
        'Number of Plugin Updates': pluginUpdateCount,
        'PHP Version': siteInfo.phpversion || site.phpversion || 'Unknown',
        'Maintenance': ['Yes']
    };

    console.log('Processed site details:', JSON.stringify(processedDetails, null, 2));
    return processedDetails;
}

async function forceUpdateDatabaseSchema() {
    const requiredProperties = {
        'Domain': { title: {} },
        'Site URL': { url: {} },
        'Number of Plugin Updates': { number: {} },
        'Number of Security Issues': { number: {} },
        'Site Health Score': { number: {} },
        'Core Update Available': { multi_select: { options: [{ name: "Yes" }, { name: "No" }] } },
        'PHP Version': { rich_text: {} },
        'Last Checked': { date: {} },
        'Maintenance': { multi_select: { options: [{ name: "Yes" }, { name: "No" }] } }
    };

    try {
        console.log('Forcibly updating database schema...');
        const response = await axios.patch(
            `https://api.notion.com/v1/databases/${formattedDatabaseId}`,
            {
                properties: requiredProperties
            },
            {
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            }
        );
        console.log('Database schema updated successfully');
        return response.data.properties;
    } catch (error) {
        console.error('Error updating database schema:', error.response?.data || error.message);
        return null;
    }
}

async function queryNotionDatabase(domain) {
    try {
        const response = await axios.post(
            `https://api.notion.com/v1/databases/${formattedDatabaseId}/query`,
            {
                filter: {
                    property: "Domain",
                    title: {
                        equals: domain
                    }
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            }
        );
        return response.data.results;
    } catch (error) {
        console.error(`Error querying Notion database for ${domain}:`, error.response?.data || error.message);
        return null;
    }
}

async function updateNotionPage(pageId, domain, siteDetails) {
    try {
        const properties = {
            'Domain': { title: [{ text: { content: domain } }] },
            'Last Checked': { date: { start: new Date().toISOString() } },
        };

        if (siteDetails) {
            if (siteDetails['Site URL']) properties['Site URL'] = { url: siteDetails['Site URL'] };
            if (siteDetails['Number of Plugin Updates'] !== undefined) properties['Number of Plugin Updates'] = { number: siteDetails['Number of Plugin Updates'] };
            if (siteDetails['Number of Security Issues'] !== undefined) properties['Number of Security Issues'] = { number: siteDetails['Number of Security Issues'] };
            if (siteDetails['Site Health Score'] !== undefined) properties['Site Health Score'] = { number: siteDetails['Site Health Score'] };
            if (siteDetails['Core Update Available']) properties['Core Update Available'] = { multi_select: siteDetails['Core Update Available'].map(option => ({ name: option })) };
            if (siteDetails['PHP Version']) properties['PHP Version'] = { rich_text: [{ text: { content: siteDetails['PHP Version'] } }] };
            if (siteDetails['Maintenance']) properties['Maintenance'] = { multi_select: siteDetails['Maintenance'].map(option => ({ name: option })) };
        }

        const response = await axios.patch(
            `https://api.notion.com/v1/pages/${pageId}`,
            { properties },
            {
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            }
        );
        console.log(`Successfully updated page for ${domain}`);
        return response.data;
    } catch (error) {
        console.error(`Error updating Notion page for ${domain}:`, error.response?.data || error.message);
        console.log('Attempted to update with properties:', JSON.stringify(properties, null, 2));
    }
}

async function createNotionPage(domain, siteDetails) {
    try {
        const properties = {
            'Domain': { title: [{ text: { content: domain } }] },
            'Last Checked': { date: { start: new Date().toISOString() } },
            'Site URL': { url: null },
            'Number of Plugin Updates': { number: 0 },
            'Number of Security Issues': { number: 0 },
            'Site Health Score': { number: 0 },
            'Core Update Available': { multi_select: [{ name: "No" }] },
            'PHP Version': { rich_text: [{ text: { content: "Unknown" } }] },
            'Maintenance': { multi_select: [{ name: "No" }] }
        };

        if (siteDetails) {
            if (siteDetails['Site URL']) properties['Site URL'] = { url: siteDetails['Site URL'] };
            if (siteDetails['Number of Plugin Updates'] !== undefined) properties['Number of Plugin Updates'] = { number: siteDetails['Number of Plugin Updates'] };
            if (siteDetails['Number of Security Issues'] !== undefined) properties['Number of Security Issues'] = { number: siteDetails['Number of Security Issues'] };
            if (siteDetails['Site Health Score'] !== undefined) properties['Site Health Score'] = { number: siteDetails['Site Health Score'] };
            if (siteDetails['Core Update Available']) properties['Core Update Available'] = { multi_select: siteDetails['Core Update Available'].map(option => ({ name: option })) };
            if (siteDetails['PHP Version']) properties['PHP Version'] = { rich_text: [{ text: { content: siteDetails['PHP Version'] } }] };
            if (siteDetails['Maintenance']) properties['Maintenance'] = { multi_select: siteDetails['Maintenance'].map(option => ({ name: option })) };
        }

        const response = await axios.post(
            'https://api.notion.com/v1/pages',
            {
                parent: { database_id: formattedDatabaseId },
                properties: properties
            },
            {
                headers: {
                    'Authorization': `Bearer ${NOTION_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                }
            }
        );
        console.log(`Successfully created page for ${domain}`);
        return response.data;
    } catch (error) {
        console.error(`Error creating Notion page for ${domain}:`, error.response?.data || error.message);
    }
}

async function syncDomainToNotion(domainInfo) {
    const siteDetails = await fetchSiteDetails(domainInfo.url);

    console.log(`Site details for ${domainInfo.domain}:`, JSON.stringify(siteDetails, null, 2));

    const existingPages = await queryNotionDatabase(domainInfo.domain);

    if (existingPages && existingPages.length > 0) {
        console.log(`Updating existing entry for ${domainInfo.domain}`);
        await updateNotionPage(existingPages[0].id, domainInfo.domain, siteDetails);
    } else {
        console.log(`Creating new entry for ${domainInfo.domain}`);
        await createNotionPage(domainInfo.domain, siteDetails);
    }
}

async function main() {
    console.log('Forcibly updating Notion database schema...');
    await forceUpdateDatabaseSchema();

    console.log('Fetching domains from Virtualmin...');
    const rawData = await fetchDomains();
    const domainInfos = processDomains(rawData);

    console.log(`\n${domainInfos.length} domains found on server.`);

    console.log('\nSyncing domains to Notion database...');
    for (const domainInfo of domainInfos) {
        await syncDomainToNotion(domainInfo);
    }

    console.log('\nSync completed!');
}

main().catch(console.error);