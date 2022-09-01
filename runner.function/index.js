const {Octokit} = require('@octokit/rest');
const {ExecutionsClient} = require('@google-cloud/workflows');
const {functions} = require('@google-cloud/functions-framework');
const {createHmac} = require('node:crypto');
const axios = require('axios');

var meta = {};

async function get_project() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/project/project-id", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data;
}

async function get_region() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/zone", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data.split('/').at(-1).slice(0, -2);
}

function shuffle(array) {
   if(array.length == 0)
      return;
   for(let i = array.length - 1; i > 0; i--) {
      const rand = Math.floor(Math.random() * (i + 1));
      [array[i], array[rand]] = [array[rand], array[i]];
   }
}

async function doit(req, res, template, config) {
   const octokit = new Octokit({
      auth: process.env.GITHUB_API_TOKEN
   });
   const tokenres = await octokit.rest.actions.createRegistrationTokenForRepo({
      owner: req.body.repository.owner.login,
      repo: req.body.repository.name,
    });
   if(tokenres.status != 201 || !(tokenres.data?.token)) {
      res.status(500).send(`request for a runner token returned ${tokenres.status}`);
      return;
   }

   let zone_arrays = config.zones;
   for(let i = 0; i < zone_arrays.length; i++)
      shuffle(zone_arrays[i]);

   const workflow_arguments = {
      instanceTemplate: template,
      instanceName: `runner-${req.body.workflow_job.id}`,
      maxRuntime: config.maxtime,
      zones: zone_arrays.flat(),
      metadata: [
         {"key": "runnerToken",
          "value": tokenres.data.token},
         {"key": "runnerURL",
          "value": req.body.repository.html_url},
         {"key": "runnerLabel",
          "value": template}
      ]
   };

   if(Object.keys(meta).length == 0)
      ({0:meta.project, 1:meta.region} = await Promise.all([get_project(), get_region()]));

   const executionsclient = new ExecutionsClient();
   const createExecutionRes = await executionsclient.createExecution({
      parent: `projects/${meta.project}/locations/${meta.region}/workflows/${process.env.RUNNER_WORKFLOW}`,
      execution: {
         argument: JSON.stringify(workflow_arguments)
      }
    });
    res.status(200).send(`Started workflow execution ${createExecutionRes[0].name}`);
}

exports.on_workflow_job = (req, res) => {
   if(!(process.env.GITHUB_WH_SECRET) || !(process.env.GITHUB_API_TOKEN) || !(process.env.RUNNER_WORKFLOW) || !(process.env.TEMPLATE_CONFIG)) {
      res.status(500).send("Missing required environment variables")
      return;
   }

   const hmac = createHmac('sha256', process.env.GITHUB_WH_SECRET);
   hmac.update(req.rawBody);
   if(req.get('X-HUB-SIGNATURE-256') != `sha256=${hmac.digest().toString('hex')}`) {
      res.status(401).end();
      return;
   }

   if(req.get('X-GitHub-Event') == "ping") {
      res.status(200).end();
   }
   else if(req.get('X-GitHub-Event') == "workflow_job") {
      const config = JSON.parse(process.env.TEMPLATE_CONFIG);
      const use = req.body.workflow_job.labels.filter(l => l in config);
      if(req.body.action == "in_progress" || req.body.action == "completed" || use.length === 0) {
         res.status(200).end();
      }
      else {
         doit(req, res, use[0], config[use[0]]);
      }
   }
   else {
      res.status(500).end();
   }
};