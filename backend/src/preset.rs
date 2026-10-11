//! Reads the HTML file that the Arma 3 Launcher exports for a mod preset or
//! for its list of mods.

use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mod {
    pub id: u64,
    pub name: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Preset {
    pub name: String,
    pub mods: Vec<Mod>,
    /// Mods without a Workshop ID. The server can't download them.
    pub local_mods: Vec<String>,
    pub dlcs: Vec<String>,
}

pub fn parse(html: &str) -> anyhow::Result<Preset> {
    let doc = Html::parse_document(html);
    let mod_rows: Vec<_> = doc
        .select(&selector("tr[data-type=ModContainer]"))
        .collect();
    let dlc_rows: Vec<_> = doc
        .select(&selector("tr[data-type=DlcContainer]"))
        .collect();
    // "preset" for an exported preset, "list" for an exported list of mods,
    // which has no name.
    let kind = meta(&doc, "arma:Type");
    if !matches!(kind.as_deref(), Some("preset" | "list")) {
        anyhow::bail!("Not a preset or mod list exported by the Arma 3 Launcher");
    }

    let mut preset = Preset {
        name: meta(&doc, "arma:PresetName").unwrap_or_else(|| "Mod list".to_owned()),
        mods: Vec::new(),
        local_mods: Vec::new(),
        dlcs: dlc_rows.iter().map(|row| display_name(*row)).collect(),
    };
    for row in mod_rows {
        let name = display_name(row);
        let id = row
            .select(&selector("a[data-type=Link]"))
            .next()
            .and_then(|link| link.value().attr("href"))
            .and_then(workshop_id);
        match id {
            Some(id) => preset.mods.push(Mod { id, name }),
            None => preset.local_mods.push(name),
        }
    }
    Ok(preset)
}

fn meta(doc: &Html, name: &str) -> Option<String> {
    doc.select(&selector(&format!("meta[name='{name}']")))
        .next()
        .and_then(|meta| meta.value().attr("content"))
        .map(normalize_whitespace)
}

fn display_name(row: ElementRef) -> String {
    row.select(&selector("td[data-type=DisplayName]"))
        .next()
        .map(|td| normalize_whitespace(&td.text().collect::<String>()))
        .unwrap_or_default()
}

/// Names can span lines in the file.
fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The ID in a link like https://steamcommunity.com/sharedfiles/filedetails/?id=450814997
fn workshop_id(href: &str) -> Option<u64> {
    if !href.contains("steamcommunity.com/sharedfiles/filedetails") {
        return None;
    }
    let (_, query) = href.split_once('?')?;
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("id="))
        .and_then(|id| id.parse().ok())
}

fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("valid selector")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRESET: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html>
  <head>
    <meta name="arma:Type" content="preset" />
    <meta name="arma:PresetName" content="Pathfinder Ops" />
    <meta name="generator" content="Arma 3 Launcher - https://arma3.com" />
    <title>Arma 3</title>
  </head>
  <body>
    <h1>Arma 3  - Preset <strong>Pathfinder Ops</strong></h1>
    <div class="mod-list">
      <table>
        <tr data-type="ModContainer">
          <td data-type="DisplayName">CBA_A3</td>
          <td><span class="from-steam">Steam</span></td>
          <td><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=450814997" data-type="Link">https://steamcommunity.com/sharedfiles/filedetails/?id=450814997</a></td>
        </tr>
        <tr data-type="ModContainer">
          <td data-type="DisplayName">ace</td>
          <td><span class="from-steam">Steam</span></td>
          <td><a href="http://steamcommunity.com/sharedfiles/filedetails/?id=463939057" data-type="Link">http://steamcommunity.com/sharedfiles/filedetails/?id=463939057</a></td>
        </tr>
        <tr data-type="ModContainer">
          <td data-type="DisplayName">My Local Mod</td>
          <td><span class="from-local">Local</span></td>
          <td><span data-meta="local:My Local Mod|@mylocal|" /></td>
        </tr>
      </table>
    </div>
    <div class="dlc-list">
      <table>
        <tr data-type="DlcContainer">
          <td data-type="DisplayName">Contact</td>
          <td><a href="https://store.steampowered.com/app/1021790" data-type="Link">https://store.steampowered.com/app/1021790</a></td>
        </tr>
      </table>
    </div>
  </body>
</html>"#;

    #[test]
    fn parses_a_preset() {
        assert_eq!(
            parse(PRESET).unwrap(),
            Preset {
                name: "Pathfinder Ops".into(),
                mods: vec![
                    Mod {
                        id: 450814997,
                        name: "CBA_A3".into()
                    },
                    Mod {
                        id: 463939057,
                        name: "ace".into()
                    },
                ],
                local_mods: vec!["My Local Mod".into()],
                dlcs: vec!["Contact".into()],
            }
        );
    }

    /// Same structure as the launcher's "export list of mods".
    const LIST: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html>
  <head>
    <meta name="arma:Type" content="list" />
    <meta name="generator" content="Arma 3 Launcher - https://arma3.com" />
    <title>Arma 3</title>
  </head>
  <body>
    <h1>Arma 3 Mods</h1>
    <div class="mod-list">
      <table>
        <tr data-type="ModContainer">
          <td data-type="DisplayName">3CB BAF Units
            (ACE compatibility)</td>
          <td>
            <span class="from-steam">Steam</span>
          </td>
          <td>
            <a href="http://steamcommunity.com/sharedfiles/filedetails/?id=1135539579" data-type="Link">http://steamcommunity.com/sharedfiles/filedetails/?id=1135539579</a>
          </td>
        </tr>
      </table>
    </div>
    <div class="dlc-list">
      <table />
    </div>
  </body>
</html>"#;

    #[test]
    fn parses_a_mod_list() {
        assert_eq!(
            parse(LIST).unwrap(),
            Preset {
                name: "Mod list".into(),
                mods: vec![Mod {
                    id: 1135539579,
                    name: "3CB BAF Units (ACE compatibility)".into()
                }],
                local_mods: vec![],
                dlcs: vec![],
            }
        );
    }

    #[test]
    fn rejects_other_html() {
        assert!(parse("<html><body>Hello</body></html>").is_err());
        assert!(
            parse(r#"<html><head><meta name="arma:Type" content="other" /></head></html>"#)
                .is_err()
        );
    }
}
