const xapi = require('xapi');

async function getVol() {
  const vol = await xapi.Status.Audio.Volume.get()
  console.log(vol)
}

module.exports = { getVol }; 