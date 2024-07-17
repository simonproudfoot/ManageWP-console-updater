const axios = require('axios');
const { prompt } = require('inquirer');
const cliProgress = require('cli-progress');
require('dotenv').config();

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
                const choices = Object.entries(sites).map(([id, site]) => ({
                    name: `${site.name}${RESET} - ${getColorForSecurity(site.securityIssues)}Security issues: ${site.securityIssues}${RESET} - ${getColorForHealth(site.health_value)} Health: ${site.health_value}%${RESET}`,
                    value: { id, ...site }
                }));

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
                    console.log('WordPress version:', siteDetails.wp_version);
                    console.log('Site health status:', siteDetails.health_status || 'N/A');

                    // if (siteDetails.plugin_upgrades) {
                    //     console.log('\nPlugins needing updates:');
                    //     Object.entries(siteDetails.plugin_upgrades).forEach(([plugin, info]) => {
                    //         console.log(`- ${plugin}: ${info.update.new_version}`);
                    //     });
                    // }

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
                        } else {
                            console.log('No WordPress core update was necessary or the update failed.');
                        }

                        if (siteDetails.plugin_upgrades && Object.keys(JSON.parse(siteDetails.plugin_upgrades)).length > 0) {
                            console.log('\nInitiating plugins update...');
                            const pluginUpdateResult = await updatePlugins(selectedSite.id);
                            if (pluginUpdateResult) {
                                console.log('Plugin update response:', pluginUpdateResult);
                            } else {
                                console.log('Plugin update failed or no updates were necessary.');
                            }
                        } else {
                            console.log('\nNo plugin updates available according to MainWP data.');
                        }

                        console.log('\nUpdate requests sent. Please check the MainWP dashboard for detailed update status.');
                        console.log('Fetching latest site details...');
                        const updatedSiteDetails = await fetchSiteDetails(selectedSite.id);
                        if (updatedSiteDetails) {
                            const siteInfo = JSON.parse(updatedSiteDetails.site_info || '{}');
                            console.log('Current WordPress version:', siteInfo.wpversion || 'Unknown');
                            const pluginUpgrades = JSON.parse(updatedSiteDetails.plugin_upgrades || '{}');
                            console.log('Current plugin updates available:', Object.keys(pluginUpgrades).length);
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