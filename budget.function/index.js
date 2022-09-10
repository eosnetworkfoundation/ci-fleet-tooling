const Firestore = require('@google-cloud/firestore');

const firestore = new Firestore();

async function doit(event, complete) {
   await firestore.doc('monitoring/budget').set({
      cost: JSON.parse(Buffer.from(event.data, 'base64').toString()).costAmount,
      time: Firestore.Timestamp.now()
    });
   complete();
}

exports.budgetPubSub = (event, context, complete) => {
   doit(event, complete);
};