/**
 * FreeSWITCH XML Configuration Generator
 *
 * Generates all FreeSWITCH XML config files directly from the pbx_admin database.
 * Pushes them to the FS server via SSH/SCP and reloads.
 *
 * This completely replaces FusionPBX as the source of truth.
 */
import { queryPbxDb } from '../db/pbx-admin-db';

export interface ExtensionFile {
  filename: string;
  content: string;
}

export interface GatewayFile {
  profile: string;
  filename: string;
  content: string;
}

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type IvrDialplanAction = { application: string; data?: string };

function normalizeSipHost(value: string): string {
  return (value || '')
    .trim()
    .replace(/^sip:/i, '')
    .replace(/;.*$/, '')
    .replace(/\/.*$/, '');
}

function mapIvrOptionToDialplanActions(action: string, param: string, domainName: string): IvrDialplanAction[] {
  const fsAction = (action || '').trim();
  const fsParam = (param || '').trim();
  if (!fsAction) return [{ application: 'hangup' }];

  if (fsAction === 'menu-play-sound' && fsParam) {
    return [{ application: 'playback', data: fsParam }];
  }

  if (fsAction === 'menu-sub' && fsParam) {
    // Keep submenu support for nested menus.
    return [{ application: 'ivr', data: fsParam }];
  }

  if (fsAction === 'menu-exec-app') {
    const cc = fsParam.match(/^callcenter\s+(\S+)/i);
    if (cc) {
      const q = cc[1].includes('@') ? cc[1] : `${cc[1]}@${domainName}`;
      return [{ application: 'callcenter', data: q }];
    }

    const tr = fsParam.match(/^transfer\s+(.+)$/i);
    if (tr) return [{ application: 'transfer', data: tr[1] }];

    if (!fsParam || fsParam.toLowerCase() === 'hangup') {
      return [{ application: 'hangup', data: 'NORMAL_CLEARING' }];
    }
  }

  return [{ application: 'hangup', data: 'NORMAL_CLEARING' }];
}

function normalizeGreetingPath(greeting: string, domainName: string): string {
  const value = (greeting || '').trim();
  if (!value) return '';
  if (value.startsWith('/') || value.startsWith('$') || value.includes('://')) return value;
  return `/var/lib/freeswitch/recordings/${domainName}/${value}`;
}

async function buildInlineIvrActions(menuName: string, domainId: string, domainName: string): Promise<IvrDialplanAction[]> {
  const menu = await queryPbxDb(
    `SELECT * FROM ivr_menus WHERE domain_id = $1 AND name = $2 AND enabled = true LIMIT 1`,
    [domainId, menuName]
  );
  if (!menu?.length) return [{ application: 'hangup', data: 'NO_ROUTE_DESTINATION' }];

  const currentMenu = menu[0];
  const options = await queryPbxDb(
    `SELECT * FROM ivr_options WHERE ivr_menu_id = $1 AND enabled = true ORDER BY option_order`,
    [currentMenu.id]
  );

  const actions: IvrDialplanAction[] = [];
  const greeting = normalizeGreetingPath(currentMenu.greet_long || currentMenu.greet_short, domainName);
  if (greeting) actions.push({ application: 'playback', data: greeting });

  // Inbound route behavior is deterministic: after greeting, execute timeout route.
  const timeoutOption = options.find((o: any) => (o.digits || '').trim() === 'timeout')
    || options.find((o: any) => (o.digits || '').trim() === 'invalid');
  if (timeoutOption) {
    actions.push(...mapIvrOptionToDialplanActions(timeoutOption.action, timeoutOption.param || '', domainName));
  } else {
    actions.push({ application: 'hangup', data: 'NORMAL_CLEARING' });
  }

  return actions;
}

// ─── PUBLIC DIALPLAN (inbound routes) ───

export async function generatePublicXml(domainName: string, domainId: string): Promise<string> {
  const routes = await queryPbxDb(
    `SELECT * FROM inbound_routes WHERE domain_id = $1 ORDER BY route_order, name`,
    [domainId]
  );

  let extensions = '';
  for (const route of routes) {
    if (!route.enabled) continue;
    const did = route.did || route.name;
    const regex = route.did_regex || `^${did}$`;

    let actions = '';
    actions += `        <action application="log" data="ERR INBOUND DID ${did} FROM=\${caller_id_number} NETWORK=\${network_addr}"/>\n`;
    actions += `        <action application="set" data="call_direction=inbound"/>\n`;

    if (route.destination_type === 'queue') {
      const qt = route.destination_target.includes('@')
        ? route.destination_target
        : `${route.destination_target}@${domainName}`;
      actions += `        <action application="set" data="hold_music=local_stream://tavl_moh"/>\n`;
      actions += `        <action application="answer"/>\n`;
      actions += `        <action application="sleep" data="1000"/>\n`;
      actions += `        <action application="callcenter" data="${escapeXml(qt)}"/>\n`;
      actions += `        <action application="hangup"/>`;
    } else if (route.destination_type === 'ivr') {
      actions += `        <action application="answer"/>\n`;
      actions += `        <action application="sleep" data="1000"/>\n`;
      const ivrActions = await buildInlineIvrActions(route.destination_target, domainId, domainName);
      for (const action of ivrActions) {
        if (action.data !== undefined) {
          actions += `        <action application="${escapeXml(action.application)}" data="${escapeXml(action.data)}"/>\n`;
        } else {
          actions += `        <action application="${escapeXml(action.application)}"/>\n`;
        }
      }
    } else if (route.destination_type === 'extension') {
      actions += `        <action application="answer"/>\n`;
      actions += `        <action application="bridge" data="user/${escapeXml(route.destination_target)}@${domainName}"/>`;
    } else if (route.destination_type === 'ringgroup') {
      actions += `        <action application="answer"/>\n`;
      actions += `        <action application="bridge" data="user/${escapeXml(route.destination_target)}@${domainName}"/>`;
    } else {
      actions += `        <action application="hangup"/>`;
    }

    extensions += `    <extension name="${escapeXml(route.name || did)}">\n`;
    extensions += `      <condition field="destination_number" expression="${escapeXml(regex)}">\n`;
    extensions += `${actions}\n`;
    extensions += `      </condition>\n`;
    extensions += `    </extension>\n`;
  }

  return `<include>
  <context name="public">
${extensions}    <extension name="public-catch-all">
      <condition field="destination_number" expression="^(.+)$">
        <action application="hangup" data="NO_ROUTE_DESTINATION"/>
      </condition>
    </extension>
  </context>
</include>`;
}

// ─── DEFAULT DIALPLAN (internal calls, outbound, features) ───

export async function generateDefaultXml(domainName: string, domainId: string): Promise<string> {
  const outboundRoutes = await queryPbxDb(
    `SELECT r.*, g.name as gateway_name, g.profile as gateway_profile, g.proxy as gateway_proxy, g.realm as gateway_realm
     FROM outbound_routes r
     LEFT JOIN gateways g ON r.gateway_id = g.id
     WHERE r.domain_id = $1 AND r.enabled = true
     ORDER BY r.route_order`,
    [domainId]
  );

  const ringGroups = await queryPbxDb(
    `SELECT rg.*, json_agg(json_build_object(
       'extension', rgm.extension, 'delay', rgm.delay_seconds, 'timeout', rgm.timeout_seconds
     )) as members
     FROM ring_groups rg
     LEFT JOIN ring_group_members rgm ON rg.id = rgm.ring_group_id
     WHERE rg.domain_id = $1 AND rg.enabled = true
     GROUP BY rg.id
     ORDER BY rg.name`,
    [domainId]
  );

  let exts = '';

  // Echo test
  exts += `    <extension name="echo_test">
      <condition field="destination_number" expression="^\\*43$">
        <action application="answer"/>
        <action application="echo"/>
      </condition>
    </extension>\n\n`;

  // Ring groups
  for (const rg of ringGroups) {
    if (rg.extension) {
      const members = (rg.members || []).filter((m: any) => m.extension);
      if (members.length === 0) continue;

      let bridgeStr: string;
      if (rg.strategy === 'simultaneous') {
        bridgeStr = members.map((m: any) => `user/${m.extension}@${domainName}`).join(',');
      } else {
        bridgeStr = members.map((m: any) => `user/${m.extension}@${domainName}`).join('|');
      }

      exts += `    <extension name="ring_group_${escapeXml(rg.name)}">\n`;
      exts += `      <condition field="destination_number" expression="^${escapeXml(rg.extension)}$">\n`;
      exts += `        <action application="set" data="bypass_media=false"/>\n`;
      exts += `        <action application="set" data="rtp_secure_media=optional"/>\n`;
      exts += `        <action application="set" data="call_timeout=${rg.timeout || 30}"/>\n`;
      exts += `        <action application="set" data="hangup_after_bridge=true"/>\n`;
      exts += `        <action application="set" data="continue_on_fail=true"/>\n`;
      exts += `        <action application="record_session" data="$\${recordings_dir}/\${uuid}.wav"/>\n`;
      exts += `        <action application="bridge" data="${escapeXml(bridgeStr)}"/>\n`;
      if (rg.no_answer_dest) {
        if (rg.no_answer_dest_type === 'ivr') {
          exts += `        <action application="ivr" data="${escapeXml(rg.no_answer_dest)}"/>\n`;
        } else if (rg.no_answer_dest_type === 'queue') {
          const qt = rg.no_answer_dest.includes('@') ? rg.no_answer_dest : `${rg.no_answer_dest}@${domainName}`;
          exts += `        <action application="callcenter" data="${escapeXml(qt)}"/>\n`;
        } else {
          exts += `        <action application="bridge" data="user/${escapeXml(rg.no_answer_dest)}@${domainName}"/>\n`;
        }
      }
      exts += `      </condition>\n`;
      exts += `    </extension>\n\n`;
    }
  }

  // Internal 3-digit extensions
  // export (not set) so the B-leg (callee) also inherits bypass_media=false and
  // rtp_secure_media=optional — required for WebRTC-to-WebRTC DTLS negotiation.
  exts += `    <extension name="internal_3digit">
      <condition field="destination_number" expression="^([1-9]\\d{2})$">
        <action application="export" data="dialed_extension=$1"/>
        <action application="export" data="bypass_media=false"/>
        <action application="export" data="rtp_secure_media=optional"/>
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="continue_on_fail=true"/>
        <action application="record_session" data="$\${recordings_dir}/\${uuid}.wav"/>
        <action application="bridge" data="user/$1@${domainName}"/>
      </condition>
    </extension>\n\n`;

  // Internal 4-digit extensions
  exts += `    <extension name="internal_4digit">
      <condition field="destination_number" expression="^([1-9]\\d{3})$">
        <action application="export" data="dialed_extension=$1"/>
        <action application="export" data="bypass_media=false"/>
        <action application="export" data="rtp_secure_media=optional"/>
        <action application="set" data="call_timeout=30"/>
        <action application="set" data="hangup_after_bridge=true"/>
        <action application="set" data="continue_on_fail=true"/>
        <action application="record_session" data="$\${recordings_dir}/\${uuid}.wav"/>
        <action application="bridge" data="user/$1@${domainName}"/>
      </condition>
    </extension>\n\n`;

  // Outbound routes
  for (const route of outboundRoutes) {
    const gwName = route.gateway_name || 'trunk-itsp';
    const gwProfile = route.gateway_profile || 'wan';
    const gwHost = normalizeSipHost(route.gateway_proxy || route.gateway_realm || '');
    const outboundTarget = gwHost
      ? `sofia/${gwProfile}/$1@${gwHost}`
      : `sofia/gateway/${gwName}/$1`;
    exts += `    <extension name="outbound_${escapeXml(route.name)}">\n`;
    exts += `      <condition field="destination_number" expression="${escapeXml(route.pattern)}">\n`;
    if (route.caller_id_number) {
      exts += `        <action application="set" data="effective_caller_id_number=${escapeXml(route.caller_id_number)}"/>\n`;
    }
    if (route.caller_id_name) {
      exts += `        <action application="set" data="effective_caller_id_name=${escapeXml(route.caller_id_name)}"/>\n`;
    }
    exts += `        <action application="set" data="hangup_after_bridge=true"/>\n`;
    exts += `        <action application="record_session" data="$\${recordings_dir}/\${uuid}.wav"/>\n`;
    exts += `        <action application="bridge" data="${escapeXml(outboundTarget)}"/>\n`;
    exts += `      </condition>\n`;
    exts += `    </extension>\n\n`;
  }

  // Conference bridge
  exts += `    <extension name="conference">
      <condition field="destination_number" expression="^(conf_.+)$">
        <action application="answer"/>
        <action application="conference" data="$1@default"/>
      </condition>
    </extension>\n\n`;

  exts += `    <extension name="conference_admin">
      <condition field="destination_number" expression="^(confadmin_.+)$">
        <action application="answer"/>
        <action application="conference" data="$1@default+flags{moderator}"/>
      </condition>
    </extension>\n`;

  return `<include>
  <context name="default">
${exts}  </context>
</include>`;
}

// ─── IVR CONFIGURATION ───

export async function generateIvrConfXml(domainName: string, domainId: string): Promise<string> {
  const menus = await queryPbxDb(
    `SELECT * FROM ivr_menus WHERE domain_id = $1 AND enabled = true ORDER BY name`,
    [domainId]
  );

  let menusXml = '';
  for (const menu of menus) {
    const options = await queryPbxDb(
      `SELECT * FROM ivr_options WHERE ivr_menu_id = $1 AND enabled = true ORDER BY option_order`,
      [menu.id]
    );

    let entriesXml = '';
    for (const opt of options) {
      entriesXml += `      <entry action="${escapeXml(opt.action)}" digits="${escapeXml(opt.digits)}" param="${escapeXml(opt.param || '')}"/>\n`;
    }

    menusXml += `    <menu name="${escapeXml(menu.name)}"
          greet-long="${escapeXml(menu.greet_long || '')}"
          greet-short="${escapeXml(menu.greet_short || menu.greet_long || '')}"
          invalid-sound="${escapeXml(menu.invalid_sound || 'ivr/ivr-that_was_an_invalid_entry.wav')}"
          exit-sound="${escapeXml(menu.exit_sound || 'voicemail/vm-goodbye.wav')}"
          timeout="${menu.timeout || 10000}"
          inter-digit-timeout="${menu.inter_digit_timeout || 2000}"
          max-failures="${menu.max_failures || 3}"
          max-timeouts="${menu.max_timeouts || 3}"
          digit-len="${menu.digit_len || 1}">\n`;
    menusXml += entriesXml;
    menusXml += `    </menu>\n`;
  }

  return `<configuration name="ivr.conf" description="IVR menus">
  <menus>
${menusXml}  </menus>
</configuration>`;
}

// ─── CALLCENTER CONFIGURATION ───

export async function generateCallcenterConfXml(domainName: string, domainId: string): Promise<string> {
  const queues = await queryPbxDb(
    `SELECT * FROM queues WHERE domain_id = $1 AND enabled = true ORDER BY name`,
    [domainId]
  );

  const agents = await queryPbxDb(
    `SELECT * FROM queue_agents WHERE domain_id = $1 ORDER BY extension`,
    [domainId]
  );

  const tiers = await queryPbxDb(
    `SELECT t.*, a.extension as agent_ext, q.name as queue_name
     FROM queue_tiers t
     JOIN queue_agents a ON t.agent_id = a.id
     JOIN queues q ON t.queue_id = q.id
     ORDER BY t.tier_level, t.tier_position`,
  );

  let queuesXml = '';
  for (const q of queues) {
    const qName = q.name.includes('@') ? q.name : `${q.name}@${domainName}`;
    // Normalize moh-sound: bare names (no protocol) become local_stream://name
    const rawMoh = q.moh_sound || 'local_stream://queue_greeting';
    const mohSound = rawMoh.includes('://') ? rawMoh : `local_stream://${rawMoh}`;
    const announceFreq = q.announce_frequency || 0;
    const announceSound = q.announce_sound || '';
    queuesXml += `    <queue name="${escapeXml(qName)}">
      <param name="strategy" value="${escapeXml(q.strategy || 'round-robin')}"/>
      <param name="moh-sound" value="${escapeXml(mohSound)}"/>
      <param name="time-base-score" value="${escapeXml(q.time_base_score || 'system')}"/>
      <param name="max-wait-time" value="${q.max_wait_time || 0}"/>
      <param name="max-wait-time-with-no-agent" value="${q.max_wait_time_no_agent || 120}"/>
      <param name="max-wait-time-with-no-agent-time-reached" value="${q.max_wait_time_no_agent_reached || 5}"/>
      <param name="tier-rules-apply" value="${q.tier_rules_apply ? 'true' : 'false'}"/>
      <param name="tier-rule-wait-second" value="${q.tier_rule_wait_second || 15}"/>
      <param name="tier-rule-wait-multiply-level" value="${q.tier_rule_wait_multiply ? 'true' : 'false'}"/>
      <param name="tier-rule-no-agent-no-wait" value="${q.tier_rule_no_agent_no_wait ? 'true' : 'false'}"/>
      <param name="discard-abandoned-after" value="${q.discard_abandoned_after || 60}"/>
      <param name="abandoned-resume-allowed" value="${q.abandoned_resume_allowed ? 'true' : 'false'}"/>
      <param name="record-template" value="${escapeXml(q.record_template || '')}"/>
      <param name="ring-progressively-delay" value="0"/>
      <param name="skip-agents-with-external-calls" value="true"/>
      <param name="agent-no-answer-status" value="On Break"/>
      <param name="announce-position" value="${announceFreq > 0 ? 'yes' : 'no'}"/>
      <param name="announce-holdtime" value="${announceFreq > 0 ? 'once' : 'no'}"/>
      <param name="announce-frequency" value="${announceFreq}"/>
      <param name="announce-to-first-user" value="yes"/>${announceSound ? `\n      <param name="announce-sound" value="${escapeXml(announceSound)}"/>` : ''}
    </queue>\n`;
  }

  let agentsXml = '';
  for (const a of agents) {
    const contact = `{call_timeout=${a.call_timeout || 20},domain_name=${domainName}}user/${a.extension}@${domainName}`;
    agentsXml += `    <agent name="${escapeXml(a.extension)}@${domainName}" type="${escapeXml(a.agent_type || 'callback')}" contact="${escapeXml(contact)}" status="${escapeXml(a.status || 'Available')}" max-no-answer="${a.max_no_answer || 3}" wrap-up-time="${a.wrap_up_time || 5}" reject-delay-time="${a.reject_delay_time || 10}" busy-delay-time="${a.busy_delay_time || 60}" no-answer-delay-time="${a.no_answer_delay_time || 0}"/>\n`;
  }

  let tiersXml = '';
  for (const t of tiers) {
    const agentName = `${t.agent_ext}@${domainName}`;
    const queueName = t.queue_name.includes('@') ? t.queue_name : `${t.queue_name}@${domainName}`;
    tiersXml += `    <tier agent="${escapeXml(agentName)}" queue="${escapeXml(queueName)}" level="${t.tier_level || 1}" position="${t.tier_position || 1}"/>\n`;
  }

  return `<configuration name="callcenter.conf" description="CallCenter">
  <settings>
  </settings>
  <queues>
${queuesXml}  </queues>
  <agents>
${agentsXml}  </agents>
  <tiers>
${tiersXml}  </tiers>
</configuration>`;
}

// ─── SIP DIRECTORY (extensions) ───
// One file per extension under /etc/freeswitch/directory/<domain>/<ext>.xml

export async function generateExtensionXmlFiles(domainName: string, domainId: string): Promise<ExtensionFile[]> {
  const exts = await queryPbxDb<any>(
    `SELECT extension, password, caller_id_name, caller_id_number, enabled,
            voicemail_enabled, voicemail_password, call_timeout, description
       FROM extensions WHERE domain_id = $1 AND enabled = true ORDER BY extension`,
    [domainId]
  );

  return exts.map((e) => {
    const cidName = e.caller_id_name || e.extension;
    const cidNum = e.caller_id_number || e.extension;
    const vmPass = e.voicemail_password || e.password;
    const content = `<include>
  <user id="${escapeXml(e.extension)}">
    <params>
      <param name="password" value="${escapeXml(e.password)}"/>
      <param name="vm-password" value="${escapeXml(vmPass)}"/>
      <param name="vm-enabled" value="${e.voicemail_enabled ? 'true' : 'false'}"/>
    </params>
    <variables>
      <variable name="toll_allow" value="domestic,international,local"/>
      <variable name="accountcode" value="${escapeXml(e.extension)}"/>
      <variable name="user_context" value="default"/>
      <variable name="effective_caller_id_name" value="${escapeXml(cidName)}"/>
      <variable name="effective_caller_id_number" value="${escapeXml(cidNum)}"/>
      <variable name="outbound_caller_id_name" value="${escapeXml(cidName)}"/>
      <variable name="outbound_caller_id_number" value="${escapeXml(cidNum)}"/>
      <variable name="call_timeout" value="${e.call_timeout || 30}"/>
    </variables>
  </user>
</include>
`;
    return { filename: `${e.extension}.xml`, content };
  });
}

// All extensions in one XML file — used instead of per-extension files to
// reduce sync from N×SCP to a single SCP regardless of extension count.
export async function generateAllExtensionsXml(domainName: string, domainId: string): Promise<string> {
  const exts = await queryPbxDb<any>(
    `SELECT extension, password, caller_id_name, caller_id_number, enabled,
            voicemail_enabled, voicemail_password, call_timeout,
            dnd, call_forward_enabled, call_forward_dest,
            codecs, dtmf_mode, max_contacts, nat_enabled
       FROM extensions WHERE domain_id = $1 AND enabled = true ORDER BY extension`,
    [domainId],
  );

  const users = exts.map((e: any) => {
    const cidName = e.caller_id_name || e.extension;
    const cidNum = e.caller_id_number || e.extension;
    const vmPass = e.voicemail_password || e.password;
    const codecStr = Array.isArray(e.codecs) && e.codecs.length ? e.codecs.join(',') : 'PCMU,PCMA,OPUS';
    const dtmfType = e.dtmf_mode || 'rfc2833';
    const maxReg = e.max_contacts ?? 1;

    let params = `      <param name="password" value="${escapeXml(e.password)}"/>
      <param name="vm-password" value="${escapeXml(vmPass)}"/>
      <param name="vm-enabled" value="${e.voicemail_enabled ? 'true' : 'false'}"/>
      <param name="codec-string" value="${escapeXml(codecStr)}"/>
      <param name="dtmf-type" value="${escapeXml(dtmfType)}"/>
      <param name="max-registrations" value="${maxReg}"/>`;

    let vars = `      <variable name="toll_allow" value="domestic,international,local"/>
      <variable name="accountcode" value="${escapeXml(e.extension)}"/>
      <variable name="user_context" value="default"/>
      <variable name="effective_caller_id_name" value="${escapeXml(cidName)}"/>
      <variable name="effective_caller_id_number" value="${escapeXml(cidNum)}"/>
      <variable name="outbound_caller_id_name" value="${escapeXml(cidName)}"/>
      <variable name="outbound_caller_id_number" value="${escapeXml(cidNum)}"/>
      <variable name="call_timeout" value="${e.call_timeout || 30}"/>`;

    if (e.dnd) vars += `\n      <variable name="do-not-disturb" value="true"/>`;
    if (e.call_forward_enabled && e.call_forward_dest) {
      vars += `\n      <variable name="call_forward_all" value="true"/>`;
      vars += `\n      <variable name="call_forward" value="user/${escapeXml(e.call_forward_dest)}@${escapeXml(domainName)}"/>`;
    }
    if (e.nat_enabled) vars += `\n      <variable name="nat-options-ping" value="true"/>`;

    return `  <user id="${escapeXml(e.extension)}">
    <params>
${params}
    </params>
    <variables>
${vars}
    </variables>
  </user>`;
  }).join('\n');

  return `<include>\n${users}\n</include>\n`;
}

// Domain include file /etc/freeswitch/directory/<domain>.xml
export function generateDomainIncludeXml(domainName: string): string {
  return `<include>
  <domain name="${escapeXml(domainName)}">
    <params>
      <param name="dial-string" value="{^^:sip_invite_domain=\${dialed_domain}:presence_id=\${dialed_user}@\${dialed_domain}}\${sofia_contact(*/\${dialed_user}@\${dialed_domain})}"/>
    </params>
    <variables>
      <variable name="default_areacode" value="918"/>
      <variable name="default_country" value="US"/>
    </variables>
    <groups>
      <group name="default">
        <users>
          <X-PRE-PROCESS cmd="include" data="${escapeXml(domainName)}/*.xml"/>
        </users>
      </group>
    </groups>
  </domain>
</include>
`;
}

// ─── SIP GATEWAYS (trunks) ───
// One file per gateway under /etc/freeswitch/sip_profiles/<profile>/<name>.xml

export async function generateGatewayXmlFiles(domainId: string): Promise<GatewayFile[]> {
  const gws = await queryPbxDb<any>(
    `SELECT id, name, proxy, port, username, password, realm, from_user, from_domain,
            register, register_transport, expire_seconds, retry_seconds,
            caller_id_in_from, ping, profile, enabled
       FROM gateways WHERE domain_id = $1 AND enabled = true ORDER BY name`,
    [domainId]
  );

  return gws.map((g) => {
    const realm = g.realm || g.proxy;
    const proxy = g.port && g.port !== 5060 ? `${g.proxy}:${g.port}` : g.proxy;
    const params: string[] = [];
    params.push(`    <param name="realm" value="${escapeXml(realm)}"/>`);
    params.push(`    <param name="proxy" value="${escapeXml(proxy)}"/>`);
    params.push(`    <param name="register" value="${g.register ? 'true' : 'false'}"/>`);
    params.push(`    <param name="register-transport" value="${escapeXml(g.register_transport || 'udp')}"/>`);
    if (g.username) params.push(`    <param name="username" value="${escapeXml(g.username)}"/>`);
    if (g.password) params.push(`    <param name="password" value="${escapeXml(g.password)}"/>`);
    if (g.from_user) params.push(`    <param name="from-user" value="${escapeXml(g.from_user)}"/>`);
    if (g.from_domain) params.push(`    <param name="from-domain" value="${escapeXml(g.from_domain)}"/>`);
    params.push(`    <param name="caller-id-in-from" value="${g.caller_id_in_from ? 'true' : 'false'}"/>`);
    params.push(`    <param name="expire-seconds" value="${g.expire_seconds || 800}"/>`);
    params.push(`    <param name="retry-seconds" value="${g.retry_seconds || 30}"/>`);
    if (g.ping && g.ping > 0) params.push(`    <param name="ping" value="${g.ping}"/>`);

    const content = `<include>
  <gateway name="${escapeXml(g.name)}">
${params.join('\n')}
  </gateway>
</include>
`;
    return { profile: g.profile || 'external', filename: `${g.name}.xml`, content };
  });
}

// ─── MOH local_stream.conf.xml ───

export async function generateLocalStreamConfXml(domainId: string): Promise<string> {
  const mohs = await queryPbxDb<any>(
    `SELECT name, rate, path, shuffle, channels FROM moh_classes WHERE domain_id = $1 ORDER BY name`,
    [domainId]
  );

  let dirs = '';
  for (const m of mohs) {
    const dir = m.path || `/var/lib/freeswitch/storage/moh/${m.name}`;
    dirs += `  <directory name="${escapeXml(m.name)}" path="${escapeXml(dir)}">
    <param name="rate" value="${m.rate || 8000}"/>
    <param name="shuffle" value="${m.shuffle ? 'true' : 'false'}"/>
    <param name="channels" value="${m.channels || 1}"/>
    <param name="interval" value="20"/>
    <param name="timer-name" value="soft"/>
  </directory>
`;
  }

  return `<configuration name="local_stream.conf" description="Stream files from local dir">
${dirs}</configuration>`;
}

