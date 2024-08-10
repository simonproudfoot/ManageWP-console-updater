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

// MainWP configuration
const MAINWP_DASHBOARD_URL = process.env.MAINWP_DASHBOARD_URL;
const CONSUMER_KEY = process.env.WP_MANAGE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WP_MANAGE_SECRET_KEY;

// Color codes for console output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

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
        .filter(item => item.name.trim() !== '' && !item.name.includes('----'))
        .map(item => {
            const parts = item.name.split(/\s+/);
            return parts[0];
        })
        .filter(name => name !== 'Domain');
}

async function fetchSiteDetails(url) {
  console.log('LETS GO', url)
    const sitesEndpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/sites/get-sites-by-url`;
    try {
        const response = await axios.get(sitesEndpoint, {
            params: { 
                consumer_key: CONSUMER_KEY, 
                consumer_secret: CONSUMER_SECRET, 
                urls: url
            }
        });

        const sites = response.data;
        if (typeof sites === 'object' && sites !== null && Object.keys(sites).length > 0) {
            const siteId = Object.keys(sites)[0];
            const site = sites[siteId];
            return processSiteDetails(site);
        } else {
            console.log(url, 'not found in WP manage');
            return null;
        }
    } catch (error) {
        console.error(`Error fetching details for ${url}:`, error.message);
        return null;
    }
}

function processSiteDetails(site) {
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

    return {
        name: site.name,
        url: site.url,
        securityIssues: site.securityIssues,
        healthValue: site.health_value,
        hasCoreUpdate: hasCoreUpdate,
        pluginUpdateCount: pluginUpdateCount,
        wpVersion: siteInfo.wpversion || site.wp_version || 'Unknown',
        phpVersion: siteInfo.phpversion || site.phpversion || 'Unknown',
        childVersion: siteInfo.child_version || 'Unknown',
        lastCheckStatus: `${site.http_response_code} - ${site.http_response_code === '200' ? 'OK' : 'Error'}`
    };
}

function getColorForSecurity(issues) {
    return issues > 0 ? RED : GREEN;
}

function getColorForHealth(value) {
    return value >= 80 ? GREEN : value >= 50 ? YELLOW : RED;
}

async function listSiteDetails(domainNames) {
    for (const domain of domainNames) {
        const siteDetails = await fetchSiteDetails(domain);
        
        if (siteDetails) {
            console.log(
                `Name: ${siteDetails.name} | ` +
                `URL: ${siteDetails.url} | ` +
                `Security issues: ${getColorForSecurity(siteDetails.securityIssues)}${siteDetails.securityIssues}${RESET} | ` +
                `Site health: ${getColorForHealth(siteDetails.healthValue)}${siteDetails.healthValue}%${RESET} | ` +
             //  `WordPress: ${siteDetails.wpVersion} | ` +
             //   `MainWP Child: ${siteDetails.childVersion} | ` +
                `Core Update: ${siteDetails.hasCoreUpdate ? RED + 'Available' : GREEN + 'Up to date'}${RESET} | ` +
                `Plugin Updates: ${siteDetails.pluginUpdateCount > 0 ? YELLOW : GREEN}${siteDetails.pluginUpdateCount}${RESET}`
            );
        } else {
            console.log(`${RED}${domain} - Not found on WPmanage${RESET}`);
        }
    }
}

async function main() {
    console.log('Fetching domains from Virtualmin...');
    const rawData = await fetchDomains();
    const domainNames = processDomains(rawData);
    
    console.log(`\n${domainNames.length} domains found on server.`);
    
    // console.log("\nDomain Names:");
    // domainNames.forEach(name => console.log(name));
    
    console.log('\nFetching site details from MainWP...');
    await listSiteDetails(domainNames);
}

main().catch(console.error);