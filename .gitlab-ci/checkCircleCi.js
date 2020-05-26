const bent = require("bent");
const getJSON = bent("json");
const { promisify } = require("util");
const sleep = promisify(setTimeout);

////// GitLab CICD variables
// The CircleCI API token
const token = process.env.CIRCLE_CI_API_TOKEN
// The GitLab branch for the commit
const branch = process.env.CI_COMMIT_REF_NAME
// The limit for the number of results from the CircleCI API, default 10
const limit = process.env.CIRCLE_CI_API_LIMIT ? process.env.CIRCLE_CI_API_LIMIT : 10
// The git commit SHA
const gitlabSha = process.env.CI_COMMIT_SHA;
// The name of the GitLab project (this matches in CircleCI)
const project = process.env.CI_PROJECT_NAME;
//////

// CircleCI API url components
const baseUrl = "https://circleci.hautelook.net/api/v1.1/project/gh/hautelook/";
const tokenParam = "?circle-token=" + token;
const queryParams = "&limit=" + limit + "&shallow=true";

// Total time = iterations * (sleepMs / 1000) / 60
// 354 * 10 / 60 = 59 mins
// GitLab times out pipelines after 60 mins
const iterations = 354;
const sleepMs = 10000;

// CircleCI statuses that should indicate a pipeline failure
const failedStatuses = ["canceled", "infrastructure_fail", "timedout", "failed"];
// CircleCI statuses that should indicate a pipeline success
const successStatuses = ["fixed", "success"]
// For reference, remaining available CircleCI status types which will result in the pipeline
// continuing to run expecting a different status change:
// "retried", "not_run", "running", "queued", "scheduled", "not_running", "no_tests"

// Returns the build status for a single CircleCI job
async function checkBuildStatus(url) {
    try {
        let response = await getJSON(url);
        console.log("Build status is " + response.status);
        return response.status;
    } catch {
        console.error("There was an error checking the build status from CircleCI");
        process.exit(1);
    }
}

// Returns the build url for a single CircleCI job
async function checkBuildUrl(url) {
    try {
        let response = await getJSON(url);
        console.log("Build url is " + response.build_url);
        return response.build_url;
    } catch {
        console.error("There was an error checking the build url from CircleCI");
        process.exit(1);
    }
}

// Returns the build number for a given commit, or 0 if not found
async function checkForBuild(url, sha) {
    console.log("Checking CircleCI builds for commit " + sha);
    try {
        let response = await getJSON(url);
        for (var i = 0; i < response.length; i++) {
            if (response[i].vcs_revision == sha) {
                console.log("Found build number " + response[i].build_num + " for commit " + sha);
                return response[i].build_num;
            }
        }
        return 0;
    } catch {
        console.error("There was an error retrieving recent builds for this project from CircleCI");
        process.exit(1);
    }
};

async function start() {
    var buildNum;
    var count = 0;
    var found = false;
    while (count <= iterations && !found) {
        // Try to find the build number for the commit SHA on the branch
        buildNum = await checkForBuild(baseUrl + project + "/tree/" + branch + tokenParam + queryParams, gitlabSha);
        if (buildNum == 0) {
            console.log("Not found, waiting " + sleepMs + "ms before checking again");
            await sleep(sleepMs);
            count++;
        } else {
            found = true;
            break;
        }
    }

    // The build wasn't found, exit with error
    if (!found) {
        console.error("Unable to locate a build in CircleCI for commit " + gitlabSha);
        process.exit(1);
    }

    // Continue with remaining time
    while (count <= iterations) {
        let buildStatus = await checkBuildStatus(baseUrl + project + "/" + buildNum + tokenParam);
        let buildUrl = await checkBuildUrl(baseUrl + project + "/" + buildNum + tokenParam);
        if (failedStatuses.includes(buildStatus)) {
            console.log("Go to " + buildUrl + " to get more details on the CircleCI build failure.");
            process.exit(1);
        } else if (successStatuses.includes(buildStatus)) {
            console.log("The build completed successfully");
            console.log("Go to " + buildUrl + " to check the CircleCI build details.");
            break;
        }
        await sleep(sleepMs);
        count++;
    }
}

start();
