import xapi from 'xapi';

/* Configuration Tests*/

xapi.Config.Audio.DefaultVolume.set(50);

xapi.Config.Audio.DefaultVolume.on(defaultVol => {
  console.log(`DefaultVolume Updated: ${defaultVol}`);
  xapi.Config.Audio.DefaultVolume.set(50);
})

xapi.Config.Audio.DefaultVolume.once(defaultVol => {
  console.log(`DefaultVolume Updated once: ${defaultVol}`);
  xapi.Config.Audio.DefaultVolume.set(50);
})

xapi.Config.Audio.DefaultVolume.on(defaultVol => {
  console.log(`DefaultVolume Updated: ${defaultVol}`);
  xapi.Config.Audio.DefaultVolume.set(50);
})

xapi.Config.Audio.DefaultVolume.once(defaultVol => {
  console.log(`DefaultVolume Updated once: ${defaultVol}`);
  xapi.Config.Audio.DefaultVolume.set(50);
})

xapi.Config.Audio.DefaultVolume.get(vol => console.log(`DefaultVolume Retreived: ${vol}`));

xapi.Config.Audio.DefaultVolume.set(75);

/* Command Tests */

xapi.Command.Audio.Volume.Set({ Level: 20 });

xapi.Command.Audio.Volume.Set({ Level: 50 });

xapi.Command.UserInterface.Message.Alert.Display({ Title: `Hello`, Text: `World`, Duration: 10 });

xapi.Command.UserInterface.Extensions.Panel.Save({ PanelId: `TestPanel` }, `<Extensions>
  <Version>1.11</Version>
  <Panel>
    <Order>99</Order>
    <Location>ControlPanel</Location>
    <Icon>Proximity</Icon>
    <Name>TestPanel</Name>
    <ActivityType>Custom</ActivityType>
  </Panel>
</Extensions>`)

/* Status Tests */

xapi.Status.Audio.Volume.on(vol => {
  console.log(vol)
  if (vol != 20) {
    xapi.Command.Audio.Volume.Set({ Level: 20 });
  }
})

xapi.Status.Audio.Volume.once(vol => {
  console.log(vol)
  if (vol != 20) {
    xapi.Command.Audio.Volume.Set({ Level: 20 });
  }
})

xapi.Status.Audio.Volume.on(vol => {
  console.log(vol)
  if (vol != 20) {
    xapi.Command.Audio.Volume.Set({ Level: 20 });
  }
})

xapi.Status.Audio.Volume.once(vol => {
  console.log(vol)
  if (vol != 20) {
    xapi.Command.Audio.Volume.Set({ Level: 20 });
  }
})

/* Event Tests */

xapi.Event.UserInterface.Extensions.Panel.Clicked.on(({ PanelId }) => {
  console.log(PanelId);
  xapi.Command.UserInterface.Extensions.Widget.Action({ WidgetId: 'test', Type: 'Clicked', Value: '' })
})

xapi.Event.UserInterface.Extensions.Panel.Clicked.once(({ PanelId }) => {
  console.log(PanelId);
  xapi.Command.UserInterface.Extensions.Widget.Action({ WidgetId: 'test', Type: 'Clicked', Value: '' })
})

xapi.Event.UserInterface.Extensions.Panel.Clicked.on(({ PanelId }) => {
  console.log(PanelId);
  xapi.Command.UserInterface.Extensions.Widget.Action({ WidgetId: 'test', Type: 'Clicked', Value: '' })
})

xapi.Event.UserInterface.Extensions.Panel.Clicked.once(({ PanelId }) => {
  console.log(PanelId);
  xapi.Command.UserInterface.Extensions.Widget.Action({ WidgetId: 'test', Type: 'Clicked', Value: '' })
})