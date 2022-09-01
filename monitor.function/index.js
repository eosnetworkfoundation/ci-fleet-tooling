const axios = require('axios');
const compute = require('@google-cloud/compute');
const {ExecutionsClient} = require('@google-cloud/workflows');
const {Firestore} = require('@google-cloud/firestore');
const {Octokit} = require('@octokit/rest');

const instancesClient = new compute.InstancesClient();
const executionsClient = new ExecutionsClient();
const firestore = new Firestore();
const octokit = new Octokit({
   auth: process.env.GITHUB_API_TOKEN
});

var meta = {};

async function get_project() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/project/project-id", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data;
}

async function get_region() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/zone", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data.split('/').at(-1).slice(0, -2);
}

async function sendmessage(text, messageId) {
   const baseurl = `https://api.telegram.org/${process.env.TG_TOKEN}`;
   let messageopts = {
      chat_id: process.env.TG_CHANNEL,
      protect_content: true,
      text: text,
      disable_notification: true,
      message_id: messageId
   }
   if(messageopts.message_id) {
      try {
         const resp = await axios.post(`${baseurl}/editMessageText`, messageopts);
         if(resp.data.ok)
            return resp.data.result.message_id;
      } catch(e) {} //swallow error and try posting new message
   }
   delete messageopts.message_id;
   const resp = await axios.post(`${baseurl}/sendMessage`, messageopts);
   return resp.data.ok ? resp.data.result.message_id : null;
}

async function getInstanceCount() {
   return new Promise(async (resolve, reject) => {
      const aggListRequest = instancesClient.aggregatedListAsync({
         project: meta.project
      });

      let instanceCount = 0;
   
      for await(const [zone, instancesObject] of aggListRequest) {
         const instances = instancesObject.instances;
   
         if(instances?.length > 0) {
            for (const instance of instances) {
               ++instanceCount;
            }
         }
      }
      resolve(instanceCount);
   });
}

async function getRunningWorkflows() {
   return new Promise(async (resolve, reject) => {
      const listWorkflowExecutionsRequest = executionsClient.listExecutionsAsync({
         parent: executionsClient.workflowPath(meta.project, meta.region, process.env.RUNNER_WORKFLOW),
      });

      let workflowCount = 0;

      for await(const response of listWorkflowExecutionsRequest) {
         if(response.state === "ACTIVE") {
            ++workflowCount;
         }
      }
      resolve(workflowCount);
   });
}

async function getDoc(d) {
   return new Promise(async (resolve, reject) => {
      d.get().then((res) => {
         resolve(res);
      });
   });
}

async function get_workflow_jobs(job_stats, owner, repo, workflow_id) {
   const { data: {jobs: jobs} } = await octokit.rest.actions.listJobsForWorkflowRun({
      owner: owner,
      repo: repo,
      run_id: workflow_id,
   });
   for(const job of jobs) {
      if(!job.labels.includes('self-hosted'))
         continue;
      if(job_stats.seen_job_ids.includes(job.id))
         continue;
      job_stats.seen_job_ids.push(job.id);
      
      console.log(job.id, job.status, job.labels, job.started_at);
      if(job.status == 'queued') {
         job_stats.queued++;
         if(Date.parse(job.started_at) < job_stats.oldest)
            job_stats.oldest = Date.parse(job.started_at);
      }
   };
}

async function get_workflows(job_stats, owner, repo, workflow_id, status) {
   let job_promises = [];

   for await(const { data: workflowruns } of octokit.paginate.iterator(
      octokit.rest.actions.listWorkflowRuns,
      {
         owner: owner,
         repo: repo,
         workflow_id: workflow_id,
         status: status
       }
    )) {
      for(const workflowrun of workflowruns)
         job_promises.push(get_workflow_jobs(job_stats, owner, repo, workflowrun.id));
    }

    return Promise.all(job_promises);
}

async function get_outstanding_workflows(repos) {
   let job_stats = {
      queued: 0,
      oldest: Date.now(),
      seen_job_ids: []
   };

   let workflow_job_promises = [];
   repos.forEach(repo => {
      workflow_job_promises.push(get_workflows(job_stats, repo.split('/')[0], repo.split('/')[1], "build.yaml", "queued"));
      workflow_job_promises.push(get_workflows(job_stats, repo.split('/')[0], repo.split('/')[1], "build.yaml", "in_progress"));
   });

   await Promise.all(workflow_job_promises);

   job_stats.oldest = Math.floor((Date.now() - job_stats.oldest)/1000);

   return job_stats;
}

function timeDeltaString(seconds) {
   let s = "";
   if(seconds / 60) {
      s += `${Math.floor(seconds/60)}m`;
   }
   s += `${Math.floor(seconds%60)}s`
   return s;
}

async function doit(res) {
   const monitorDoc = firestore.doc('monitoring/state');
   const budgetDoc = firestore.doc('monitoring/budget');

   if(Object.keys(meta).length == 0)
      ({0:meta.project, 1:meta.region} = await Promise.all([get_project(), get_region()]));
   
   let [instanceCount, workflowCount, monitorState, budgetState, queuedJobStats] = await Promise.all([getInstanceCount(),
                                                                                                      getRunningWorkflows(),
                                                                                                      getDoc(monitorDoc),
                                                                                                      getDoc(budgetDoc),
                                                                                                      get_outstanding_workflows(JSON.parse(process.env.JOB_REPOS))]);

   monitorState = monitorState.data();

   if(!monitorState.instanceHistory)
      monitorState.instanceHistory = [];
   monitorState.instanceHistory.push(instanceCount);
   while(monitorState.instanceHistory.length > 90) //at the moment, called every 10s: 6 times a minute; let's do 15 minutes of history
      monitorState.instanceHistory.shift();
   const instanceAverage = (monitorState.instanceHistory.reduce((sum, v) => sum + v) / monitorState.instanceHistory.length).toFixed(2);

   const budgetDiffSeconds = (new Date() - budgetState.data().time.toDate()) / 1000;
   const budgetDisplay = budgetState.data().cost < 1 ? budgetState.data().cost : budgetState.data().cost.toFixed();

   const oldestQueued = queuedJobStats.queued ? `/${timeDeltaString(queuedJobStats.oldest)}` : '';

   const p = ["⠟", "⠯", "⠷", "⠾", "⠽", "⠻"][Math.floor(new Date().getSeconds()/10)];

   const newtext = `${instanceCount}i ${workflowCount}wf ${instanceAverage}μ $${budgetDisplay} ${queuedJobStats.queued}Q${oldestQueued} ${p}
   
Cost as reported ${timeDeltaString(budgetDiffSeconds)} ago, actual data is 6+ hours delayed.

Status last updated ${new Date().toISOString()}`;

   monitorState.messageId = await sendmessage(newtext, monitorState.messageId);

   await monitorDoc.set(monitorState);

   res.status(200).end();
}

exports.runMonitor = (req, res) => {
  doit(res);
};
