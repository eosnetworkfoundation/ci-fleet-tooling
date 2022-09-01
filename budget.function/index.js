const Firestore = require('@google-cloud/firestore');

const firestore = new Firestore();

async function doit(event) {
   await firestore.doc('monitoring/budget').set({
      cost: JSON.parse(Buffer.from(event.data, 'base64').toString()).costAmount,
      time: Firestore.Timestamp.now()
    });
}

exports.budgetPubSub = (event, context) => {
   doit(event);
};