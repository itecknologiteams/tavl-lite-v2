# FreeSWITCH Configuration Reference

**Server**: 192.168.20.140  
**Version**: FreeSWITCH 1.10.12 (git 46f8a2e6 2024-06-01)  
**SSH user**: iteckadmin  
**Surveyed**: 2026-04-29

---

## Table of Contents
1. [Global Settings](#1-global-settings)
2. [Loaded Modules](#2-loaded-modules)
3. [SIP Profiles](#3-sip-profiles)
4. [Trunks / Gateways](#4-trunks--gateways)
5. [ACL Lists](#5-acl-lists)
6. [Dialplan Contexts](#6-dialplan-contexts)
7. [Callcenter Queue](#7-callcenter-queue)
8. [Conference](#8-conference)
9. [Voicemail](#9-voicemail)
10. [MOH / Local Streams](#10-moh--local-streams)
11. [OPUS Codec](#11-opus-codec)
12. [XML CDR / FusionPBX](#12-xml-cdr--fusionpbx)
13. [ESL (Event Socket)](#13-esl-event-socket)
14. [Directory (Extensions)](#14-directory-extensions)
15. [pbx_admin Database Schema](#15-pbx_admin-database-schema)
16. [Sound / Recording Paths](#16-sound--recording-paths)
17. [Key Notes & Gotchas](#17-key-notes--gotchas)

---

## 1. Global Settings

**File**: `/usr/local/freeswitch/conf/vars.xml`

| Variable | Value |
|---|---|
| `global_codec_prefs` | G7221@32000h, G7221@16000h, G722, PCMU, PCMA |
| `outbound_codec_prefs` | PCMU, PCMA |
| `media_mix_inbound_outbound_codecs` | true |
| `use_profile` | internal |
| `default_language` | en |
| `default_dialect` | us |
| `default_voice` | callie |
| `record_ext` | wav |
| `external_sip_ip` | `$${local_ip_v4}` (resolves to 192.168.20.140) |
| `external_rtp_ip` | `$${local_ip_v4}` |
| `hold_music` | `local_stream://default` |
| `disable_system_api_commands` | **true** (security) |
| `disable_system_app_commands` | **true** (security) |
| `sip_tls_version` | tlsv1, tlsv1.1, tlsv1.2 |
| `internal_ssl_enable` | false |
| `external_ssl_enable` | false |
| `sound_prefix` | `$${sounds_dir}/en/us/callie` |
| `pk-ring` | %(1000,2000,400) — Pakistan ring tone |

**File**: `/usr/local/freeswitch/conf/autoload_configs/switch.conf.xml`

| Setting | Value |
|---|---|
| `max-sessions` | 1000 |
| `sessions-per-second` | 30 |
| `loglevel` | debug |
| `min-dtmf-duration` | 640 |
| `initial-event-threads` | 8 |
| `max-db-handles` | 50 |
| `db-handle-timeout` | 10s |
| `mailer-app` | `/usr/bin/php /var/www/fusionpbx/secure/v_mailto.php` (FusionPBX mailer) |
| `dump-cores` | yes |

---

## 2. Loaded Modules

**File**: `/usr/local/freeswitch/conf/autoload_configs/modules.conf.xml`

| Category | Modules |
|---|---|
| Endpoints | mod_sofia, mod_loopback |
| Dialplan | mod_dialplan_xml |
| Applications | mod_commands, mod_dptools, mod_fifo, mod_conference, mod_callcenter, mod_db, mod_hash, mod_esf, mod_fsv, mod_sms, mod_valet_parking, mod_spandsp, mod_av, mod_rtc, mod_avmd, mod_expr, mod_enum |
| Languages | mod_lua |
| Codecs | mod_g729, mod_g723_1, mod_h26x, mod_amr, mod_b64 |
| Database | **mod_pgsql** (PostgreSQL native driver) |
| Event Handlers | mod_event_socket |
| Loggers | mod_syslog, mod_console, mod_logfile |
| File Formats | mod_sndfile, mod_native_file, mod_png |
| Streams | mod_tone_stream, **mod_local_stream** |
| Say | mod_say_en |
| CDR | mod_xml_cdr |

---

## 3. SIP Profiles

### 3.1 internal.xml — Agent / WebRTC Profile

**File**: `/usr/local/freeswitch/conf/sip_profiles/internal.xml`

| Parameter | Value |
|---|---|
| **sip-port** | 5060 (UDP) |
| **ws-binding** | :5066 (plain WebSocket) |
| **wss-binding** | :7443 (secure WebSocket — used by browser agents) |
| **sip-ip** | `$${local_ip_v4}` = 192.168.20.140 |
| **rtp-ip** | `$${local_ip_v4}` = 192.168.20.140 |
| **context** | default |
| **auth-calls** | true |
| **auth-subscriptions** | true |
| **inbound-codec-prefs** | OPUS, PCMU, PCMA, G722, G729 |
| **outbound-codec-prefs** | OPUS, PCMU, PCMA, G722, G729 |
| **inbound-codec-negotiation** | generous |
| **inbound-late-negotiation** | true |
| **media_timeout** | 300s |
| **media_hold_timeout** | 1800s |
| **manage-presence** | true |
| **enable-timer** | false |
| **TLS** | disabled (`internal_ssl_enable=false`) |
| **NDLB-force-rport** | safe (enabled) |
| **record-path** | `$${recordings_dir}` |
| **record-template** | `${domain_name}/archive/${strftime(%Y)}/${strftime(%b)}/${strftime(%d)}/${uuid}.${record_ext}` |
| **dtmf-type** | rfc2833 |
| **rtp-digit-delay** | 40ms (disabled) |
| **nonce-ttl** | 60 |
| **Gateways** | None (empty) |
| **Domains** | `all` (alias=false, parse=false) |

### 3.2 wan.xml — PSTN Trunk Profile

**File**: `/usr/local/freeswitch/conf/sip_profiles/wan.xml`

| Parameter | Value |
|---|---|
| **sip-port** | 5060 |
| **sip-ip** | 172.25.99.34 (WAN IP) |
| **rtp-ip** | 172.25.99.34 |
| **ext-sip-ip** | 172.25.99.34 |
| **ext-rtp-ip** | 172.25.99.34 |
| **context** | public |
| **auth-calls** | false |
| **apply-inbound-acl** | providers |
| **inbound-codec-prefs** | PCMU, PCMA |
| **outbound-codec-prefs** | PCMU, PCMA |
| **suppress-cng** | true |
| **enable-timer** | false |
| **session-timeout** | 0 |
| **manage-presence** | false |
| **media_timeout** | 300s |
| **media_hold_timeout** | 1800s |
| **Gateways** | Includes `wan/*.xml` |

### 3.3 Other Profile Files

| File | Status |
|---|---|
| `internal-ipv6.xml.noload` | Not loaded |
| `external.xml.noload` | Not loaded |
| `external-ipv6.xml.noload` | Not loaded |
| `empty.xml` | Empty placeholder |

---

## 4. Trunks / Gateways

### trunk-itsp (Main PSTN)

**File**: `/usr/local/freeswitch/conf/sip_profiles/wan/trunk-itsp.xml`  
**Profile**: `wan`

| Parameter | Value |
|---|---|
| realm | 10.200.173.116 |
| proxy | 10.200.173.116 |
| register | false (NOREG) |
| register-transport | udp |
| from-user | **02138650302** (main inbound DID) |
| from-domain | 10.200.173.116 |
| caller-id-in-from | false |
| expire-seconds | 800 |
| retry-seconds | 30 |
| ping | every 30s |

### trunk-robocall (Robocall Outbound)

**File**: `/usr/local/freeswitch/conf/sip_profiles/external/trunk-robocall.xml`  
**Profile**: `external`

| Parameter | Value |
|---|---|
| realm | 10.200.174.222 |
| proxy | 10.200.174.222:5060 |
| register | false |
| caller-id-in-from | true |
| ping | every 60s |

### trunk-uan (UAN Outbound)

**File**: `/usr/local/freeswitch/conf/sip_profiles/external/trunk-uan.xml`  
**Profile**: `external`

| Parameter | Value |
|---|---|
| realm | 10.200.174.223 |
| proxy | 10.200.174.223:5060 |
| register | false |
| caller-id-in-from | true |
| ping | every 60s |

---

## 5. ACL Lists

**File**: `/usr/local/freeswitch/conf/autoload_configs/acl.conf.xml`

| List Name | Default | Allowed CIDRs | Used By |
|---|---|---|---|
| `lan` | allow | 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 127.0.0.0/8 | General LAN |
| `rfc1918` | **deny** | 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 127.0.0.0/8 | ESL inbound |
| `loopback.auto` | deny | 127.0.0.0/8 | Internal |
| `trusted` | **deny** | 192.168.20.0/24, 10.200.173.116/32, 10.200.174.0/24 | wan profile inbound SIP (providers ACL) |

The `wan.xml` profile uses `apply-inbound-acl = providers` — this means only CIDRs in the `trusted` list can send inbound SIP to the wan profile. This covers trunk-itsp (10.200.173.116) and trunk-robocall/uan (10.200.174.x).

---

## 6. Dialplan Contexts

Dialplan files are in `/usr/local/freeswitch/conf/dialplan/`.  
**Current files**: `default.xml`, `public.xml`, `tavl-autocall.xml`, `robocall-service.xml`  
(Backup files: `default.xml.bak.20260413130943`, `public.xml.bak`)

### 6.1 default context

**Context name**: `192.168.20.140`  
**Who uses it**: Internal extensions (registered to `internal` SIP profile, `user_context=default`)

| Extension Name | Match Pattern | Actions |
|---|---|---|
| `echo_test` | `^\*43$` | answer → echo |
| `internal_3digit` | `^([1-9]\d{2})$` | record_session → bridge `user/$1@192.168.20.140` (timeout 30s) |
| `internal_4digit` | `^([1-9]\d{3})$` | record_session → bridge `user/$1@192.168.20.140` (timeout 30s) |
| `outbound_outbound_itsp` | `^(0\d+)$` | CID=02138650302/"iTecknologi" → record_session → bridge `sofia/wan/$1@10.200.173.116` |
| `conference` | `^(conf_.+)$` | answer → conference `$1@default` |
| `conference_admin` | `^(confadmin_.+)$` | answer → conference `$1@default+flags{moderator}` |

**Notes**:
- All internal calls (3-digit and 4-digit) are recorded automatically via `record_session`.
- Outbound calls are forced to CID `02138650302 / iTecknologi` regardless of the caller's own CID.
- Conference rooms are created on-demand by dialing `conf_<name>`.
- `confadmin_<name>` makes the caller the moderator.

### 6.2 public context

**Who uses it**: Inbound calls arriving on the `wan` profile from trunk-itsp.

| Extension Name | Match Pattern | Actions |
|---|---|---|
| `2138650302` | `^\+?(?:92)?0?(2138650302)$` | Set domain/UUID → record stereo → answer → sleep 1s → playback IVR greeting → callcenter `tavl-agents@192.168.20.140` |
| `public-catch-all` | `^(.+)$` | hangup `NO_ROUTE_DESTINATION` |

**Full inbound call flow (DID 02138650302)**:
1. `domain_name = 192.168.20.140`
2. `domain_uuid = 537fb643-3af0-44cc-abc4-163b6cee7d05`
3. `call_direction = inbound`
4. Recording: `${recordings_dir}/${domain_name}/archive/${strftime(%Y)}/${strftime(%b)}/${strftime(%d)}/${uuid}.wav`
5. `record_stereo = true`, `recording_follow_transfer = true`
6. `record_session` starts
7. `answer`
8. `sleep 1000`
9. `playback /var/lib/freeswitch/recordings/192.168.20.140/1776188760445_r2_session.wav` (IVR greeting)
10. `callcenter tavl-agents@192.168.20.140`

The DID regex matches:
- `02138650302`
- `2138650302`
- `+922138650302`
- `922138650302`

### 6.3 tavl-autocall context

**Who uses it**: Outbound robocall campaigns — when the customer answers, they enter this context.

| Extension Name | Match Pattern | Actions |
|---|---|---|
| `autocall_ivr` | `^(.*)$` | answer → sleep 1s → record → playback iteck-greeting.wav → play_and_get_digits → execute_extension `autocall_route_${dtmf_digit}` |
| `autocall_route_0` | `^autocall_route_0$` | tone → callcenter `tavl-agents@192.168.20.140` → vm-goodbye → hangup |
| `autocall_hangup` | `^autocall_route_$` | hangup (no digit pressed / invalid) |

**IVR digit collection**:
```
play_and_get_digits 1 1 3 10000 # custom/iteck-greeting.wav ivr/ivr-that_was_an_invalid_entry.wav dtmf_digit \d
```
- Min digits: 1, Max digits: 1
- Max retries: 3
- Timeout: 10000ms (10s)
- Terminator: #
- Sound: `custom/iteck-greeting.wav`
- Invalid sound: `ivr/ivr-that_was_an_invalid_entry.wav`
- Variable name: `dtmf_digit`

### 6.4 robocall-service context

**Who uses it**: Internal routing for robocall originations.

| Extension Name | Match Pattern | Actions |
|---|---|---|
| `robocall_internal` | `^([1-9]\d{2,3})$` | bridge `user/$1@192.168.20.140` |
| `robocall_outbound` | `^(.+)$` | record → bridge `sofia/gateway/8229b757-0f69-47c9-9d4c-70791ac254b1/$1` |

The gateway UUID `8229b757-0f69-47c9-9d4c-70791ac254b1` is how `trunk-robocall` is referenced internally at runtime.

---

## 7. Callcenter Queue

**File**: `/usr/local/freeswitch/conf/autoload_configs/callcenter.conf.xml`

### Queue: tavl-agents@192.168.20.140

| Parameter | Value |
|---|---|
| strategy | round-robin |
| moh-sound | default |
| time-base-score | system |
| max-wait-time | 0 (unlimited) |
| max-wait-time-with-no-agent | 120s |
| max-wait-time-with-no-agent-time-reached | 5s |
| tier-rules-apply | false |
| tier-rule-wait-second | 15 |
| tier-rule-wait-multiply-level | true |
| tier-rule-no-agent-no-wait | false |
| discard-abandoned-after | 60s |
| abandoned-resume-allowed | false |
| ring-progressively-delay | 0 |
| skip-agents-with-external-calls | **true** |
| agent-no-answer-status | "On Break" |
| record-template | `$${recordings_dir}/${strftime(%Y-%m-%d-%H-%M-%S)}.${destination_number}.${caller_id_number}.${uuid}.wav` |

### Static Agents (in XML config)

| Agent | Type | call_timeout | max-no-answer | wrap-up | reject-delay | busy-delay |
|---|---|---|---|---|---|---|
| 111@192.168.20.140 | callback | 60s | 3 | 5s | 10s | 60s |
| 222@192.168.20.140 | callback | 20s | 3 | 5s | 10s | 60s |
| 999@192.168.20.140 | callback | 20s | 3 | 5s | 10s | 60s |

**Note**: These are the static agents defined in the XML config. Additional agents are added dynamically at runtime via ESL when agents log in to the ICC app. Static agent 999 is the "Robocall" virtual extension.

**Agent type `callback`**: FreeSWITCH calls the agent's registered endpoint. The agent's device rings first; once answered, the caller is bridged through.

---

## 8. Conference

**File**: `/usr/local/freeswitch/conf/autoload_configs/conference.conf`

### Default Profile

| Parameter | Value |
|---|---|
| domain | 192.168.20.140 |
| rate | 8000 Hz |
| interval | 20ms |
| energy-level | 100 |
| caller-controls | default group |
| moh-sound | `$${hold_music}` (local_stream://default) |
| enter-sound | `tone_stream://%(200,0,500,600,700)` |
| exit-sound | `tone_stream://%(500,0,300,200,100,50,25)` |

### DTMF Controls (in-conference)

| Digit | Action |
|---|---|
| 0 | Mute/unmute self |
| * | Deaf+mute self |
| # | Hangup / leave conference |
| 9 / 8 / 7 | Energy level up / equal / down |
| 3 / 2 / 1 | Talk volume up / zero / down |
| 6 / 5 / 4 | Listen volume up / zero / down |

---

## 9. Voicemail

**File**: `/usr/local/freeswitch/conf/autoload_configs/voicemail.conf.xml`

Voicemail module is loaded and configured, but **all 118 extensions have `vm-enabled=false`** in their directory XML files.

| Parameter | Value |
|---|---|
| file-extension | wav |
| max-record-len | 300s |
| min-record-len | 3s |
| max-login-attempts | 3 |
| digit-timeout | 10000ms |
| callback-context | default |
| operator-extension | `operator XML default` (key: 0) |

Voicemail is **not currently in use**. It is configured but disabled on all extensions.

---

## 10. MOH / Local Streams

**File**: `/usr/local/freeswitch/conf/autoload_configs/local_stream.conf.xml`

| Stream Name | Path | Rate | Shuffle | Used For |
|---|---|---|---|---|
| `queue_greeting` | `${sounds_dir}/music/queue_greeting/8000` | 8000 Hz | true | Queue hold music while caller waits (defined in DB but queue uses `default` MOH) |
| `tavl_moh` | `${sounds_dir}/music/tavl_moh/8000` | 8000 Hz | true | On-hold music for bridged agent calls |

**Default hold music** (`local_stream://default`): `${sounds_dir}/music/default/8000` — standard classical pieces.

The queue `tavl-agents` uses `moh-sound=default`, which plays the **default** stream, not `queue_greeting`. The `queue_greeting` stream was defined for future use.

---

## 11. OPUS Codec

**File**: `/usr/local/freeswitch/conf/autoload_configs/opus.conf.xml`

| Parameter | Value |
|---|---|
| use-vbr | 1 (variable bitrate enabled) |
| complexity | 10 (maximum) |
| keep-fec-enabled | 1 (forward error correction) |
| maxaveragebitrate | 0 (no limit, negotiate freely) |
| maxplaybackrate | 0 (no limit) |

---

## 12. XML CDR / FusionPBX

**File**: `/usr/local/freeswitch/conf/autoload_configs/xml_cdr.conf.xml`

CDR records are written in two ways:
1. **HTTP POST** to `http://127.0.0.1/app/xml_cdr/xml_cdr_import.php` (FusionPBX local web server on same machine)
2. **Disk log** to `/usr/local/freeswitch/log/xml_cdr/` (as backup)

| Parameter | Value |
|---|---|
| url | `http://127.0.0.1/app/xml_cdr/xml_cdr_import.php` |
| log-http-and-disk | true |
| log-dir | `/usr/local/freeswitch/log/xml_cdr/` |
| log-b-leg | true |
| prefix-a-leg | true |
| encode | url-encoded |
| disable-100-continue | true |

FusionPBX receives the CDR via HTTP and stores it in the `v_xml_cdr` table in the `fusionpbx` PostgreSQL database on the same host (192.168.20.140). This is the CDR source used by the ICC app (`server/db/fusionpbx.ts`).

---

## 13. ESL (Event Socket)

**File**: `/usr/local/freeswitch/conf/autoload_configs/event_socket.conf.xml`

| Parameter | Value |
|---|---|
| listen-ip | 0.0.0.0 |
| listen-port | **8021** |
| password | **ClueCon** |
| apply-inbound-acl | rfc1918 |
| nat-map | false |

The `rfc1918` ACL allows connections from: 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 127.0.0.0/8.  
The ICC app connects from 192.168.20.x, which is within the allowed range.

---

## 14. Directory (Extensions)

**Domain**: `192.168.20.140` (UUID: `537fb643-3af0-44cc-abc4-163b6cee7d05`)  
**Total extensions**: 118  
**Config path**: `/usr/local/freeswitch/conf/directory/192.168.20.140/`

### Extension XML Structure (all extensions follow same pattern)
```xml
<user id="{ext}">
  <params>
    <param name="password" value="ad{ext}da"/>      <!-- e.g., ad100da for ext 100 -->
    <param name="vm-password" value="ad{ext}da"/>
    <param name="vm-enabled" value="false"/>
  </params>
  <variables>
    <variable name="toll_allow" value="domestic,international,local"/>
    <variable name="accountcode" value="{ext}"/>
    <variable name="user_context" value="default"/>
    <variable name="effective_caller_id_name" value="{name}"/>
    <variable name="effective_caller_id_number" value="{ext}"/>
    <variable name="outbound_caller_id_name" value="{name}"/>
    <variable name="outbound_caller_id_number" value="{ext}"/>
    <variable name="call_timeout" value="30"/>
  </variables>
</user>
```

**Password formula**: `ad{ext}da` (exception: ext 999 uses `ad999a`)  
**All extensions**: vm-enabled=false, call_timeout=30, toll_allow=domestic/international/local, user_context=default

### Full Extension List

| Ext | Name |
|---|---|
| 100 | Reception |
| 101 | Nadeem Qasim |
| 102 | Agent 102 |
| 110 | Zia Abid |
| 111 | Syed Salman Hussain |
| 200 | Ubaid Mughal |
| 201 | Furqan Lodhi - Admin |
| 202 | Afser |
| 203 | Vivian Charles |
| 204 | Sidra Tiwana |
| 205 | Shabbir - Security Head |
| 206 | Adnan/Azaan |
| 222 | **Aamir Lodhi** |
| 228 | Danish/Mahnoor - Finance |
| 266 | Conference Room - 9th |
| 267 | 10TH Conf Room |
| 299 | Hasham Haroon - Recovery |
| 300 | Ayaz/Usman |
| 301 | Fahad Essani (Finance) |
| 302 | Zohra Abbasi - Finance |
| 303 | Naveed/Sheraz Khalid |
| 304 | Abdul Ahad - Recovery |
| 305 | Iqra Khan - Recovery |
| 306 | Zaynab Mustafa - Recovery |
| 307 | Muhammad Yaqoob - NR |
| 308 | Zeeshan Khan - Recovery |
| 333 | Shunaid Qureshi |
| 400 | Muhammad Zakir Bhatti |
| 401 | IT Helpdesk |
| 402 | IT Helpdesk |
| 403 | Humna Yousuf |
| 404 | HR Desk |
| 405 | HR Desk |
| 444 | Ammar Hussain |
| 469 | Syed Shahzaib Hussain - Security Briefing |
| 470 | Huzaifa Khan - Recovery |
| 471 | Owais Masood - Recovery |
| 472 | Dawood Ahmed - CSD |
| 473 | Gulraiz Jaffri - Recovery |
| 474 | Muhammad Mustafa - Recovery |
| 475 | Shahroz Dominic - Recovery |
| 476 | Usama Shahzad - Recovery |
| 477 | Muhammad Sami - Recovery |
| 478 | Anas Kamil - NRD |
| 479 | Saif Malik - Recovery |
| 480 | Rahat Gul - Recovery |
| 481 | Bilal Yabali - Security Briefing |
| 482 | Muhammad Yousuf - Recovery |
| 483 | Muhammad Hasnain - Recovery |
| 484 | Umer Ilyas - Recovery |
| 485 | Muhammad Khalid - Recovery |
| 489 | Owais Tahir |
| 490 | Nazeer Ali - Recovery Dept |
| 491 | Jawahir Saeed - Recovery |
| 492 | Waseem Tariq |
| 493 | Nazra Nazar |
| 494 | Agha Muhammad Jaffar |
| 555 | Ali Azeemi |
| 556 | Kamran Jamal |
| 557 | Muhammad Faizan Siddiqui - Marketing |
| 558 | Umer Azeem - Sales |
| 559 | Syed Muneeb - Marketing |
| 560 | Wasiq Jawed |
| 561 | Hussain Ali - Marketing |
| 562 | Mihir Parkash |
| 600 | Khurram |
| 601 | Omar Ahmed |
| 602 | Syed Zeeshan Ahmed |
| 603 | Syed Zeeshan Soft |
| 604 | Zeeshan/Araaf |
| 605 | Farjad Manzoor |
| 666 | Syed Ahmed Fareed Bokhari |
| 701 | Jehanzeb Khan - Corp/Direct Sales |
| 702 | Ahsan - Sales Coordinator |
| 704 | Hamza/Omar Software Dev |
| 705 | Zubair Hanif - TDD |
| 706 | Tariq Shahzad |
| 707 | Fahad Khan |
| 708 | Muhammad Hamza - Marketing |
| 709 | Adnan Mansoor - Marketing |
| 711 | Muhammad Faizan Siddiqui - Marketing |
| 712 | Syed Saboor Ali - Marketing |
| 713 | Mairaj Haq |
| 714 | Muhammad Shayan - Marketing |
| 715 | Muhammad Khizar - Marketing |
| 716 | Hassan Jabbar |
| 800 | Owais Akhlaq |
| 801 | Atif Khatri |
| 802 | Sobia Ali |
| 803 | Anas TDD Desk |
| 804 | Muhammad Asad Khan |
| 805 | Nayana Sanjay - Security Briefing |
| 806 | Mashood Rehman |
| 807 | Nafees Ur Rehman - Recovery |
| 809 | Asif Syed |
| 810 | Adnan Mansoor |
| 811 | Hasnain Akram - Diagnostic |
| 812 | Syed Muhammad Asad |
| 813 | Saba Aurangzaib - Recovery |
| 814 | Jawad Ali |
| 815 | Hasnain Akram |
| 816 | Faris Ahmed |
| 817 | Saddam Ali - Technical Coordinator |
| 818 | Aneel Ahmed |
| 900 | Kitchen 10th Floor |
| 911 | Kitchen - 9th Floor |
| 991 | LODHI |
| 996 | Parking - P5 |
| 997 | Harness Room |
| 998 | QM Building Parking Ramp |
| 999 | **Robocall** (virtual extension for outbound robocall) |
| 1001 | Reception |
| 1002 | RG-Main Board |
| 1003 | Main Board - 02 |
| 1004 | Main Board - 03 |
| 7031 | Farhana Faisal HP |
| 7032 | Farhana Faisal SP |
| 8000 | Owais Akhlaq Laptop |

---

## 15. pbx_admin Database Schema

**Host**: 192.168.20.140  
**DB**: pbx_admin  
**Tables**: 15

### domain
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `537fb643-3af0-44cc-abc4-163b6cee7d05` |
| name | varchar(255) | `192.168.20.140` |
| ip | varchar(255) | `192.168.20.140` |
| enabled | boolean | true |
| created_at / updated_at | timestamp | |

### extensions (118 rows)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| domain_id | uuid FK → domain | |
| extension | varchar(20) UNIQUE per domain | e.g., "100" |
| password | varchar(255) | e.g., "ad100da" |
| caller_id_name | varchar(255) | display name |
| caller_id_number | varchar(20) | same as extension |
| enabled | boolean | all true |
| description | text | |
| voicemail_enabled | boolean | all **false** |
| voicemail_password | varchar(20) | |
| call_timeout | integer | all **30** |
| created_at / updated_at | timestamp | |

### gateways (3 rows)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| domain_id | uuid FK → domain | |
| name | varchar(255) | trunk-itsp, trunk-robocall, trunk-uan |
| proxy | varchar(255) | gateway IP |
| port | integer | default 5060 |
| username / password | varchar(255) | not used (no registration) |
| realm | varchar(255) | |
| from_user | varchar(255) | 02138650302 for trunk-itsp |
| from_domain | varchar(255) | |
| register | boolean | all **false** |
| register_transport | varchar(10) | 'udp' |
| expire_seconds | integer | 800 |
| retry_seconds | integer | 30 |
| caller_id_in_from | boolean | false for itsp, true for robocall/uan |
| ping | integer | 30 or 60 |
| context | varchar(50) | 'public' |
| profile | varchar(50) | 'wan' for itsp, 'external' for others |
| enabled | boolean | |

### queues (1 row)
| Column | Type |
|---|---|
| id | uuid PK |
| domain_id | uuid FK |
| name | varchar(255) — `tavl-agents` |
| extension | varchar(20) |
| strategy | varchar(50) — `round-robin` |
| moh_sound | varchar(500) — `default` |
| announce_sound / announce_frequency | for periodic announcements |
| record_template | varchar(500) |
| time_base_score | varchar(20) — `system` |
| max_wait_time | integer — `0` |
| max_wait_time_no_agent | integer — `120` |
| max_wait_time_no_agent_reached | integer — `5` |
| tier_rules_apply | boolean — false |
| discard_abandoned_after | integer — 60 |
| abandoned_resume_allowed | boolean — false |
| enabled | boolean |

### queue_agents (3 rows — static agents)
| extension | agent_name | call_timeout | max_no_answer | wrap_up_time | reject_delay | busy_delay |
|---|---|---|---|---|---|---|
| 111 | 111 | 20s | 3 | 5 | 10 | 60 |
| 222 | 222 | 20s | 3 | 5 | 10 | 60 |
| 999 | 999 | 20s | 3 | 5 | 10 | 60 |

### queue_tiers
References queue_id + agent FK. Currently mirrors queue_agents assignments.

### inbound_routes (1 row)
| name | did | destination_type | destination_target |
|---|---|---|---|
| 2138650302 | 2138650302 | ivr | main_greeting |

Note: The `destination_type=ivr` / `destination_target=main_greeting` is what the **pbx_admin V2 app** would use to generate dialplan XML. The actual live FS dialplan (`public.xml`) routes this DID directly to callcenter, NOT through an IVR in FS — the `main_greeting` IVR is currently only in the DB, not deployed to FS dialplan.

### outbound_routes (1 row)
| name | pattern | gateway | caller_id_number |
|---|---|---|---|
| outbound_itsp | `^(0\d+)$` | trunk-itsp | 02138650302 |

### ring_groups (0 rows)
Schema: id, domain_id, name, extension, strategy (simultaneous), timeout, no_answer_dest, no_answer_dest_type, cid_prefix, enabled.  
**No ring groups configured yet.**

### ring_group_members (0 rows)
Schema: id, ring_group_id FK, extension, delay.

### ivr_menus (1 row)
| name | extension | greet_long | greet_short | timeout | digit_len |
|---|---|---|---|---|---|
| main_greeting | main_greeting | 1776188760445_r2_session.wav | 1776188760445_r2_session.wav | 5s | 1 |

### ivr_options (2 rows for main_greeting)
| digits | action | param | order |
|---|---|---|---|
| `timeout` | menu-exec-app | `callcenter tavl-agents@192.168.20.140` | 999 |
| `invalid` | menu-exec-app | `callcenter tavl-agents@192.168.20.140` | 998 |

**Note**: No DTMF digit options are defined. Only timeout and invalid handlers exist. Both send to callcenter.

### moh_classes (6 rows)
| name | rate | path |
|---|---|---|
| default | 8000 | `$${sounds_dir}/music/default/8000` |
| default | 16000 | `$${sounds_dir}/music/default/16000` |
| default | 32000 | `$${sounds_dir}/music/default/32000` |
| default | 48000 | `$${sounds_dir}/music/default/48000` |
| tavl_moh | 8000 | `${sounds_dir}/music/tavl_moh/8000` |
| queue_greeting | 8000 | `${sounds_dir}/music/queue_greeting/8000` |

### blacklist (0 rows)
### recordings (0 rows)

---

## 16. Sound / Recording Paths

| Purpose | Path |
|---|---|
| **Inbound DID IVR greeting** | `/var/lib/freeswitch/recordings/192.168.20.140/1776188760445_r2_session.wav` |
| **Autocall IVR greeting** | `/usr/local/freeswitch/sounds/custom/iteck-greeting.wav` |
| **Default sounds prefix** | `/usr/local/freeswitch/sounds/en/us/callie/` |
| **Recordings directory** (`$${recordings_dir}`) | `/usr/local/freeswitch/recordings/` |
| **Call archive recordings** | `/usr/local/freeswitch/recordings/archive/` (141 .wav files) |
| **Domain-specific archive** | `/usr/local/freeswitch/recordings/192.168.20.140/archive/YYYY/Mon/DD/` |
| **Autocall/robocall recording** | `/usr/local/freeswitch/recordings/192.168.20.140/${uuid}.wav` |
| **XML CDR log dir** | `/usr/local/freeswitch/log/xml_cdr/` |
| **MOH default** | `/usr/local/freeswitch/sounds/music/default/8000/` |
| **MOH tavl_moh** | `/usr/local/freeswitch/sounds/music/tavl_moh/8000/` |
| **MOH queue_greeting** | `/usr/local/freeswitch/sounds/music/queue_greeting/8000/` |

---

## 17. Key Notes & Gotchas

1. **IVR greeting file path is hardcoded** in `public.xml`:
   ```
   /var/lib/freeswitch/recordings/192.168.20.140/1776188760445_r2_session.wav
   ```
   This is not using the `$${recordings_dir}` variable and points to `/var/lib/freeswitch/` not `/usr/local/freeswitch/`. If this file moves or the path changes, the inbound greeting breaks silently.

2. **pbx_admin DB vs live FS dialplan are out of sync**: The `inbound_routes` table says `destination_type=ivr → main_greeting`, but the live `public.xml` routes DID 2138650302 directly to callcenter. The DB represents the V2 admin system's intended config, not what is currently deployed.

3. **No ring groups configured**: The ring_groups and ring_group_members tables are empty. Any ring group shown in PBX Admin V1 comes from reading FS config files via SSH, not the DB.

4. **No IVR digit mappings**: The `main_greeting` IVR menu in the DB only has `timeout` and `invalid` catch-alls — no actual digit options (press 1 for X, press 2 for Y). All callers route to callcenter regardless.

5. **All 118 extensions have voicemail disabled**: Voicemail module is configured but not in use anywhere.

6. **Recordings happen in multiple places**:
   - Internal/outbound calls: `$${recordings_dir}/${uuid}.wav`
   - Inbound DID calls: domain/archive/year/month/day directory structure
   - Autocall context: `/usr/local/freeswitch/recordings/192.168.20.140/${uuid}.wav`
   - Queue recording template: date-based filename with DID+caller+uuid

7. **disable_system_api_commands=true**: Set in `vars.xml`. This blocks ESL commands like `system`, `bg_system`, `exec`. The ICC app's ESL operations (originate, hangup, conference) are not affected.

8. **Trunk-itsp ping every 30s, robocall/uan every 60s**: Keep-alive OPTIONS are sent to maintain gateway state. If a trunk goes unreachable, FS will retry every 30/60s.

9. **Conference rooms are ad-hoc**: There is no pre-defined conference room list. Any call to `conf_<any_name>` creates a room on demand.

10. **Extension 999 is the robocall virtual extension**: It is registered as both a real directory entry (with password ad999a) and a static callcenter agent. The robocall originate flow likely uses this extension as the A-leg.
