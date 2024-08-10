const axios = require('axios');
const { prompt } = require('inquirer');
const cliProgress = require('cli-progress');
require('dotenv').config();
let open;
import('open').then(module => {
    open = module.default;
}).catch(err => {
    console.error('Failed to import open:', err);
});

const MAINWP_DASHBOARD_URL = process.env.MAINWP_DASHBOARD_URL || 'https://wpmanage.greenwich-design.co.uk';
const CONSUMER_KEY = process.env.WP_MANAGE_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.WP_MANAGE_SECRET_KEY;

// ANSI escape codes for colors
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function getColorForHealth(healthValue) {
    if (healthValue <= 0) return RED;
    if (healthValue > 0 && healthValue <= 50) return YELLOW;
    return GREEN;
}

function getColorForSecurity(securityIssues) {
    if (securityIssues === 0) return GREEN;
    if (securityIssues < 5) return YELLOW;
    return RED;
}

async function forceSiteSync(siteId) {
    const endpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/site/sync-site`;
    try {
        const response = await axios.post(endpoint, null, {
            params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET, site_id: siteId }
        });
        console.log('Site sync initiated:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Error syncing site ${siteId}:`, error.message);
        return null;
    }
}

async function purgeCache(siteId) {
    const endpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/site/purge-cache`;
    try {
        const response = await axios.post(endpoint, null, {
            params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET, site_id: siteId }
        });
        console.log('Cache purge response:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Error purging cache for site ${siteId}:`, error.message);
        return null;
    }
}

async function fetchSitesWithUpdates() {
    const endpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/sites/sites-available-updates-count`;
    try {
        const response = await axios.get(endpoint, {
            params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET }
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching sites with updates:', error.message);
        return null;
    }
}

async function fetchSiteDetails(siteId) {
    const endpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/site/site?site_id=${siteId}`;
    try {
        const response = await axios.get(endpoint, {
            params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching details for site ${siteId}:`, error.message);
        return null;
    }
}

async function updateWordPress(siteId) {
    const endpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/site/site-update-wordpress`;
    try {
        const response = await axios.put(endpoint, null, {
            params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET, site_id: siteId }
        });
        return response.data;
    } catch (error) {
        console.error(`Error updating WordPress for site ${siteId}:`, error.message);
        return null;
    }
}

async function updatePlugins(siteId) {
    const endpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/site/site-update-plugins`;
    try {
        const response = await axios.put(endpoint, null, {
            params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET, site_id: siteId }
        });
        console.log('Plugins update initiated:', response.data);
        return response.data;
    } catch (error) {
        console.error(`Error updating plugins for site ${siteId}:`, error.message);
        return null;
    }
}

async function waitForUpdateCompletion(siteId, updateType) {
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(100, 0);

    while (true) {
        const siteDetails = await fetchSiteDetails(siteId);
        if (!siteDetails) {
            progressBar.stop();
            console.error('Failed to fetch site details');
            return;
        }

        let progress = 0;
        if (updateType === 'wordpress') {
            progress = siteDetails.wp_core_update ? 0 : 100;
        } else if (updateType === 'plugins') {
            const totalPlugins = Object.keys(siteDetails.plugin_upgrades || {}).length;
            progress = totalPlugins === 0 ? 100 : 0;
        }

        progressBar.update(progress);

        if (progress === 100) {
            progressBar.stop();
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds before checking again
    }
}

async function listWPManageSites() {
    while (true) {
        const sitesWithUpdates = await fetchSitesWithUpdates();
        if (sitesWithUpdates) {
            console.log('\nSites with available updates:');
            console.log(`WordPress: ${sitesWithUpdates.wordpress || 0}`);
            console.log(`Plugins: ${sitesWithUpdates.plugins || 0}`);
            console.log(`Themes: ${sitesWithUpdates.themes || 0}`);
            console.log(`Total: ${sitesWithUpdates.total || 0}`);
            console.log('-----------------------------------');
        }

        const sitesEndpoint = `${MAINWP_DASHBOARD_URL}/wp-json/mainwp/v1/sites/get-sites-by-url`;
        try {
            const response = await axios.get(sitesEndpoint, {
                params: { consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET, with_tags: 2 }
            });

            const sites = response.data;
            if (typeof sites === 'object' && sites !== null) {
                const choices = Object.entries(sites).map(([id, site]) => {
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
                        name: `${site.name}${RESET} - ${getColorForSecurity(site.securityIssues)}Security: ${site.securityIssues}${RESET} - ${getColorForHealth(site.health_value)}Health: ${site.health_value}%${RESET} - ${hasCoreUpdate ? RED + 'Core update' : GREEN + 'Core OK'}${RESET} - ${pluginUpdateCount > 0 ? YELLOW : GREEN}Plugins: ${pluginUpdateCount}${RESET}`,
                        value: { id, ...site }
                    };
                });

                choices.push({ name: 'Exit', value: 'exit' });

                const { selectedSite } = await prompt({
                    type: 'list',
                    name: 'selectedSite',
                    message: 'Select a site to update or exit:',
                    choices: choices,
                    pageSize: 100
                });

                if (selectedSite === 'exit') {
                    console.log('Exiting...');
                    break;
                }

                console.log('\nFetching detailed information for', selectedSite.name);

                const siteDetails = await fetchSiteDetails(selectedSite.id);

                if (siteDetails) {
                    console.log('\nSite Details:');
                    console.log('Name:', selectedSite.name);
                    console.log('URL:', selectedSite.url);
                    console.log(`Security issues: ${getColorForSecurity(selectedSite.securityIssues)}${selectedSite.securityIssues}${RESET}`);
                    console.log(`Site health: ${getColorForHealth(selectedSite.health_value)}${selectedSite.health_value}${RESET}`);
                    
                    // Parse site_info JSON if it exists
                    let siteInfo = {};
                    try {
                        siteInfo = JSON.parse(siteDetails.site_info || '{}');
                    } catch (error) {
                        console.error('Error parsing site_info:', error.message);
                    }
                
                    console.log('WordPress Version:', siteInfo.wpversion || siteDetails.wp_version || 'Unknown');
                    console.log('Debug Mode:', siteInfo.debug_mode ? 'Enabled' : 'Disabled');
                    console.log('PHP Version:', siteInfo.phpversion || siteDetails.phpversion || 'Unknown');
                    console.log('MainWP Child Version:', siteInfo.child_version || 'Unknown');
                    console.log('PHP Memory Limit:', siteInfo.memory_limit || 'Unknown');
                    console.log('MySQL Version:', siteInfo.mysql_version || 'Unknown');
                    console.log('cURL version:', siteInfo.child_curl_version || 'Unknown');
                    console.log('OpenSSL version:', siteInfo.child_openssl_version || 'Unknown');
                    console.log('Server IP:', siteInfo.ip || siteDetails.ip || 'Unknown');
                    console.log('Last Check Status:', `${siteDetails.http_response_code} - ${siteDetails.http_response_code === '200' ? 'OK' : 'Error'}`);
                
                    // If tags are available, display them
                    if (siteDetails.tags) {
                        console.log('Tags:', siteDetails.tags);
                    }

                    const { performUpdates } = await prompt({
                        type: 'confirm',
                        name: 'performUpdates',
                        message: 'Do you want to perform updates on this site?',
                        default: false
                    });

                    if (performUpdates) {
                        console.log('\nChecking and potentially updating WordPress core...');
                        const wpUpdateResult = await updateWordPress(selectedSite.id);
                        if (wpUpdateResult) {
                            console.log('WordPress core update response:', wpUpdateResult);
                            
                            // Attempt to purge cache after core update
                            console.log('Attempting to purge cache...');
                            await purgeCache(selectedSite.id);
                        } else {
                            console.log('No WordPress core update was necessary or the update failed.');
                        }
                    
                        if (siteDetails.plugin_upgrades && Object.keys(JSON.parse(siteDetails.plugin_upgrades)).length > 0) {
                            console.log('\nInitiating plugins update...');
                            const pluginUpdateResult = await updatePlugins(selectedSite.id);
                            if (pluginUpdateResult) {
                                console.log('Plugin update response:', pluginUpdateResult);
                                
                                // Attempt to purge cache after plugin updates
                                console.log('Attempting to purge cache...');
                                await purgeCache(selectedSite.id);
                            } else {
                                console.log('Plugin update failed or no updates were necessary.');
                            }
                        } else {
                            console.log('\nNo plugin updates available according to MainWP data.');
                        }
                    
                        console.log('\nForcing WP Manage to sync with the updated site...');
                        await forceSiteSync(selectedSite.id);
                    
                        console.log('Waiting for sync to complete...');
                        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds
                    
                        console.log('Fetching latest site details...');
                        const updatedSiteDetails = await fetchSiteDetails(selectedSite.id);
                        if (updatedSiteDetails) {
                            const siteInfo = JSON.parse(updatedSiteDetails.site_info || '{}');
                            console.log('Current WordPress version:', siteInfo.wpversion || 'Unknown');
                            const pluginUpgrades = JSON.parse(updatedSiteDetails.plugin_upgrades || '{}');
                            console.log('Current plugin updates available:', Object.keys(pluginUpgrades).length);
                            
                            // Ask user if they want to open the site in browser
                            const { openBrowser } = await prompt({
                                type: 'confirm',
                                name: 'openBrowser',
                                message: 'Do you want to open this site in your browser?',
                                default: true
                            });
                    
                            if (openBrowser) {
                                if (open) {
                                    console.log('Opening site in browser...');
                                    await open(selectedSite.url);
                                } else {
                                    console.log('Unable to open browser: open module not loaded');
                                }
                            }
                        }
                    }
                }
            } else {
                console.log('Unexpected response format. Raw data:');
                console.log(JSON.stringify(sites, null, 2));
            }
        } catch (error) {
            console.error('Error fetching WP Manage sites:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
        }
    }
}

listWPManageSites()
    .then(() => console.log('Script completed successfully.'))
    .catch((error) => {
        console.error('An error occurred while running the script:');
        console.error(error);
        process.exit(1);
    });


    