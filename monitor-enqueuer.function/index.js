const {CloudTasksClient} = require('@google-cloud/tasks');
const axios = require('axios');

const client = new CloudTasksClient();

var meta = {};

async function get_project() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/project/project-id", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data;
}

async function get_region() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/zone", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data.split('/').at(-1).slice(0, -2);
}

async function get_identity() {
   return (await axios.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", {responseType:"text", headers:{"Metadata-Flavor": "Google"}})).data;
}

async function doit(complete) {
   if(Object.keys(meta).length == 0)
      ({0:meta.project, 1:meta.region, 2:meta.identity} = await Promise.all([get_project(), get_region(), get_identity()]));

   let createPromises = [];
   [0, 10, 20, 30, 40, 50].forEach((offset) => {
      createPromises.push(client.createTask({
         parent: client.queuePath(meta.project, meta.region, process.env.TASK_QUEUE),
         task: {
            httpRequest: {
               url: process.env.MONITOR_FUNCTION,
               oidcToken: {
                  serviceAccountEmail: meta.identity
               }
            },
            scheduleTime: {
               seconds: offset + Date.now() / 1000
            }
         }
      }));
   });

   await Promise.all(createPromises);
   complete();
}

exports.enqueueit = (event, context, complete) => {
  doit(complete);
};
