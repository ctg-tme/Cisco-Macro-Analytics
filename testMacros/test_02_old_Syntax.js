import xapi from 'xapi';

/* Configuration Tests */

xapi.config.set('Audio DefaultVolume', 50);

xapi.config.on('Audio DefaultVolume', defaultVol => {
  console.log(`DefaultVolume Updated: ${defaultVol}`);
  xapi.config.set('Audio DefaultVolume', 50);
});

xapi.config.once('Audio DefaultVolume', defaultVol => {
  console.log(`DefaultVolume Updated once: ${defaultVol}`);
  xapi.config.set('Audio DefaultVolume', 50);
});

xapi.config.on('Audio DefaultVolume', defaultVol => {
  console.log(`DefaultVolume Updated: ${defaultVol}`);
  xapi.config.set('Audio DefaultVolume', 50);
});

xapi.config.once('Audio DefaultVolume', defaultVol => {
  console.log(`DefaultVolume Updated once: ${defaultVol}`);
  xapi.config.set('Audio DefaultVolume', 50);
});

xapi.config.get('Audio DefaultVolume', vol => console.log(`DefaultVolume Retrieved: ${vol}`));

xapi.config.set('Audio DefaultVolume', 75);

/* Command Tests */

xapi.command('Audio Volume Set', { Level: 20 });

xapi.command('Audio Volume Set', { Level: 50 });

xapi.command('UserInterface Message Alert Display', { Title: `Hello`, Text: `World`, Duration: 10 });

xapi.command('UserInterface Extensions Panel Save', { PanelId: `TestPanel` }, `<Extensions>
  <Version>1.11</Version>
  <Panel>
    <Order>99</Order>
    <Location>ControlPanel</Location>
    <Icon>Proximity</Icon>
    <Name>TestPanel</Name>
    <ActivityType>Custom</ActivityType>
  </Panel>
</Extensions>`);

/* Status Tests */

xapi.status.on('Audio Volume', vol => {
  console.log(vol);
  if (vol !== 20) {
    xapi.command('Audio Volume Set', { Level: 20 });
  }
});

xapi.status.once('Audio Volume', vol => {
  console.log(vol);
  if (vol !== 20) {
    xapi.command('Audio Volume Set', { Level: 20 });
  }
});

xapi.status.on('Audio Volume', vol => {
  console.log(vol);
  if (vol !== 20) {
    xapi.command('Audio Volume Set', { Level: 20 });
  }
});

xapi.status.once('Audio Volume', vol => {
  console.log(vol);
  if (vol !== 20) {
    xapi.command('Audio Volume Set', { Level: 20 });
  }
});

/* Event Tests */

xapi.event.on('UserInterface Extensions Panel Clicked', ({ PanelId }) => {
  console.log(PanelId);
  xapi.command('UserInterface Extensions Widget Action', { WidgetId: 'test', Type: 'Clicked', Value: '' });
});

xapi.event.once('UserInterface Extensions Panel Clicked', ({ PanelId }) => {
  console.log(PanelId);
  xapi.command('UserInterface Extensions Widget Action', { WidgetId: 'test', Type: 'Clicked', Value: '' });
});

xapi.event.on('UserInterface Extensions Panel Clicked', ({ PanelId }) => {
  console.log(PanelId);
  xapi.command('UserInterface Extensions Widget Action', { WidgetId: 'test', Type: 'Clicked', Value: '' });
});

xapi.event.once('UserInterface Extensions Panel Clicked', ({ PanelId }) => {
  console.log(PanelId);
  xapi.command('UserInterface Extensions Widget Action', { WidgetId: 'test', Type: 'Clicked', Value: '' });
});
