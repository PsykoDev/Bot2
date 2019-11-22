// Init
async function init(){
  const path = require('path');
  const log = require('log')('client');
  const settings = require('../settings/_tera-client_.json');
  // updater

  if(settings.autoUpdate) {
    log.info('Checking for updates')
    try {
      if(await (new (require('updater'))).update({
				dir: path.join(__dirname, '../'),
				manifestUrl: 'https://raw.githubusercontent.com/Kloct/tera-client/cli/manifest.json',
				defaultUrl: 'https://raw.githubusercontent.com/kloct/tera-client/cli/',
			})) {
				log.info('TERA Client has been updated. Please restart it to apply changes.')
				return
			}
			log.info('Client is up to date')
    }
    catch(e) {
      log.error('Error checking for updates:')
      if(e.request) log.error(e.message)
			else log.error(e)
    }
  }
  const { ModManager, Dispatch, Connection, FakeClient } = require('tera-proxy-game');
  // preload mods
  const modManager = new ModManager({
		modsDir: path.join(__dirname, '../mods'),
		settingsDir: path.join(__dirname, '../settings'),
		autoUpdate: settings.autoUpdateMods
  })
  await modManager.init()

  // client
  const webClient = require('tera-auth-ticket');

  const describe = (() => {
    const races = ['Human', 'High Elf', 'Aman', 'Castanic', 'Popori', 'Baraka'];
    const genders = ['Male', 'Female'];
    const classes = [
      'Warrior', 'Lancer', 'Slayer', 'Berserker', 'Sorcerer', 'Archer',
      'Priest', 'Mystic', 'Reaper', 'Gunner', 'Brawler', 'Ninja', 'Valkyrie',
    ];
    return function describe(character) {
      let description = '';
      const race = races[character.race] || '?';
      const gender = genders[character.gender] || '?';
      if (character.race < 4) {
        description += `${race} ${gender}`;
      } else {
        if (character.race === 4 && character.gender === 1) {
          description += 'Elin';
        } else {
          description += race;
        }
      }
      description += ' ' + (classes[character['class']] || '?') + ' / ';
      description += character.level;
      return description;
    };
  })();
  
  const revisions = require('tera-data/revisions.json')
  function getProtocolVersion (object){
    return parseInt(Object.keys(object).find(key => object[key].includes(settings.region.toLowerCase())))
  }
  // main
  const web = new webClient(settings.email, settings.password);
  
  web.getLogin((err, data) => {
    if (err) return;
    const dispatch = new Dispatch(modManager);
    const connection = new Connection(dispatch, { classic: settings.region.split('-')[1] === 'CLASSIC' });
    const client = new FakeClient(connection);
    const srvConn = connection.connect(client, { host: settings.serverip, port: settings.port });
    let closed = false;
    function closeClient() {
      if (closed) return;
      closed = true;
      client.close();
      setImmediate(() => {
        process.exit();
      });
    }
    // set up core bot features
      // `connect` handler
    client.on('connect', () => {
      // set protocol version and load mods
      connection.dispatch.setProtocolVersion(getProtocolVersion(revisions));
      dispatch.loadAll()
      // authorization
      dispatch.write('sendServer', 'C_LOGIN_ARBITER', 2, {
        unk1: 0,
        unk2: 0,
        language: 2,
        patchVersion: dispatch.getPatchVersion()*100,
        name: data.name,
        ticket: new Buffer.from(data.ticket)
      });
      // get character list
      dispatch.hook('core', 'S_LOGIN_ACCOUNT_INFO', 2, () => {
        dispatch.write('sendServer', 'C_GET_USER_LIST', 1,{});
      });
      dispatch.hook('core', 'S_GET_USER_LIST', 15, (event) => {
        // parse character list
        const characters = new Map();
        for (const character of event.characters) {
          characters.set(character.name.toLowerCase(), {
            id: character.id,
            description: `${character.name} [${describe(character)}]`,
          });
        }
        // find matching character
        const character = characters.get(settings.character.toLowerCase());
        if (!character) {
          log.error(`no character "${settings.character}"`);
          log.error('character list:');
          for (const char of characters.values()) {
            log.error(`- ${char.description} (id: ${char.id})`);
          }
        } else {
          log.log(`logging onto ${character.description} (id: ${character.id})`);
          dispatch.write('sendServer', 'C_SELECT_USER', 1, {
            id: character.id,
            unk: 0,
          });
        }
      });
      // login sequence
      dispatch.hook('core', 'S_LOAD_TOPO', 3, () => {
        dispatch.write('sendServer', 'C_LOAD_TOPO_FIN', 1);
      });
      // ping-pong
      dispatch.hook('core', 'S_PING', 1, () => {
        dispatch.write('sendServer', 'C_PONG', 1);
      });
    });
    // terminate when connection ends
    client.on('close', () => {
      closeClient();
    });
    // logging
    srvConn.setTimeout(30 * 1000);
    srvConn.on('connect', () => {
      log.log(`connected to ${srvConn.remoteAddress}:${srvConn.remotePort}`);
    });
    srvConn.on('timeout', () => {
      log.error('connection timed out.');
      closeClient();
    });
    srvConn.on('close', () => {
      log.log('disconnected.');
      process.exit();
    });
    srvConn.on('error', (err) => {
      log.warn(err);
    });
  });
}
init();
