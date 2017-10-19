/*
Script page: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/nameCopy
Last update: 17 Dec 2017
Typical node fetching query (Overpass API):

[out:xml][timeout:200][bbox:29.5734571,34.1674805,33.4131022,35.925293];
(area(3601473946); area(3603791785);)->.a;
(
	node["name"](if:
		t["name"] != t["name:ar"] &&
		t["name"] != t["name:he"] &&
		t["name"] != t["name:en"] &&
		t["name"] != t["name:ru"]
	)(area.a);
	node[!"name"]["name:ar"][!"name:he"][!"name:en"][!"name:ru"](area.a);
	node[!"name"][!"name:ar"]["name:he"][!"name:en"][!"name:ru"](area.a);

	way["name"](if:
		t["name"] != t["name:ar"] &&
		t["name"] != t["name:he"] &&
		t["name"] != t["name:en"] &&
		t["name"] != t["name:ru"]
	)(area.a);
	way[!"name"]["name:ar"][!"name:he"][!"name:en"][!"name:ru"](area.a);
	way[!"name"][!"name:ar"]["name:he"][!"name:en"][!"name:ru"](area.a);

	rel["name"](if:
		t["name"] != t["name:ar"] &&
		t["name"] != t["name:he"] &&
		t["name"] != t["name:en"] &&
		t["name"] != t["name:ru"]
	)(area.a);
	rel[!"name"]["name:ar"][!"name:he"][!"name:en"][!"name:ru"](area.a);
	rel[!"name"][!"name:ar"]["name:he"][!"name:en"][!"name:ru"](area.a);
);
out meta;
*/

var Api = require("josm/api").Api;
var print = require("josm/util").println;

// custom Remove to fix the bug https://forum.openstreetmap.org/viewtopic.php?id=58375
var remove;
(function()
{
	var removeFunction;
	var builder= require("josm/builder");
	var nb = builder.NodeBuilder;
	var tempNode = nb.withPosition(10,10).create();
	removeFunction = tempNode.remove;
	remove = function remove(p, tag)
	{
		removeFunction.call(p, tag);
	}
})();

// 00A0 is non breaking space
function heEnOnly(str)
{
	return (str.search(/[^\u00A0\u0020-\u007E\u0590-\u05FF]/) === -1);
}

function arEnOnly(str)
{
	return (str.search(/[^\u00A0\u0020-\u007E\u0600-\u06FF]/) === -1);
}

function heOnly(str)
{
	return (str.search(/[^\u00A0\u0020-\u007E\u0590-\u05FF]/) === -1);
}

function arOnly(str)
{
	return (str.search(/[^\u00A0\u0020-\u007E\u0600-\u06FF]/) === -1);
}

function enOnly(str)
{
	return (str.search(/[^\u00A0\u0020-\u007E]/) === -1);
}

function hasInvalidChars(str)
{
	return (str.search(/[\u0000-\u001F\u007F]/) !== -1);
}

gErrCnt = 0;
function printErr(p, str)
{
	gErrCnt++;
	var preStr;
	if (p.isWay) preStr = "http://www.openstreetmap.org/way/" + p.id;
	else if (p.isNode) preStr = "http://www.openstreetmap.org/node/" + p.id;
	else if (p.isRelation) preStr = "http://www.openstreetmap.org/relation/" + p.id;
	else preStr = p.id;
	print(preStr + ": " + str);
}

function sameValue(str1, str2)
{
	// treat nbsp and sp as the same in comparisons
	return (str1.replace(/\u00A0/, ' ') == str2.replace(/\u00A0/, ' '));
}

var gWhiteSpaceFixes = 0;
function fixWhiteSpace(p)
{
	for (key in p.tags)
	{
		str = p.tags[key];
		newStr = str.trim().replace(/\s{2,}/, ' ');
		if (newStr != str)
		{
			p.tags[key] = newStr;
			++gWhiteSpaceFixes;
			// printErr(p, "Whitespace fixed for " + key);
		}
	}
}


var languages = [
{name: "English", tag: "name:en", check: enOnly, checkStrict: enOnly, stats: {toName: 0, fromName: 0}},
{name: "Hebrew", tag: "name:he", check: heEnOnly, checkStrict: heOnly, stats: {toName: 0, fromName: 0}},
{name: "Arabic", tag: "name:ar", check: arEnOnly, checkStrict: arOnly, stats: {toName: 0, fromName: 0}}
];

var api = require("josm/api").Api;
function traceAndFixMismatch(p, name, nameLang, lang)
{
	return false; // Disabled. Currently no tag overriding is done in order to autofix name mismatches.
	var type;
	if (p.isNode) type="node";
	else if (p.isWay) type="way";
	else if (p.isRelation) type="relation";
	var id = p.id;
	
	print("");
	print("### Autofix attempt. v: " + p.version + ", id: " + id + ", type: " + type);
	print (name + " - " + nameLang);
	print("");

	var versions = {};
	function getVersion(id, v)
	{
		if (versions[v] === undefined)
		{
			print("-- Downloading version " + v + " for id " + id + " of type " + type);
			versions[v] = api.downloadObject({id: id, type: type}, {version: Number(v)}).get(id, type);
			print (versions[v].version + " is different from " + v);
		}

		return versions[v];
	}


	var fixed = false;
	// attempt to figure out which is newer: name or name:lang.
	for (var version = p.version - 1; version > 0; --version)
	{
		var oldTags = getVersion(id, version).tags;
		var oldName = oldTags["name"];
		var oldNameLang = oldTags[lang.tag];
		print (oldName + " - " + oldNameLang);


		if ((name == oldName) && (nameLang != oldNameLang))
		{
			// nameLang is newer
			p.tags['name'] = nameLang;
			print("autofixed: name=" + nameLang + "(id " + id + ")");
			return true;
		}

		if ((name != oldName) && (nameLang == oldNameLang))
		{
			// name is newer
			p.tags[lang.tag] = name;
			print("autofixed: "+lang.tag+"=" + name + "(id " + id + ")");
			return true;
		}

		if ((name != oldName) && (nameLang != oldNameLang))
		{
			// both names changed, cannot autofix.
			break;
		}
	
		//if we're here it means:  ((name = oldName) && (nameLang = oldNameLang))
		// keep searching.
	}
	print("autofix Failed for " + id);
	return false;	
}

function main()
{
	var modifiedCnt = 0;
	var totalCnt = 0;
	var autoFixSuccess = 0;
	var autoFixFail = 0;
	var autoFixAttempts = 0;
	print("");
	print("### Running script");
	var layer = josm.layers.get(0);
	var ds = layer.data;
	ds.each(function(p) // for each element
	{
		totalCnt++;
		var name = p.tags["name"];
		var blackList = {};

		// Basic whitespace fixes for all keys and not just name keys
		fixWhiteSpace(p);

		// Basic integrity checks for all languages except ar,en,he (no bailout)
		for (key in p.tags)
		{
			if ((key == "name") || (key == "name:he") || (key == "name:en") || (key == "name:ar")) continue;
			if(hasInvalidChars(p.tags[key]))
			{
				printErr(p, key + ' has invalid characters.');
			}
		}

		// check ar,he,en integrity
		for (var i = 0; i < languages.length; ++i)
		{
			var lang = languages[i];
			var nameLang = p.tags[lang.tag];
			if (nameLang !== undefined)
			{
				if(hasInvalidChars(nameLang))
				{
					printErr(p, lang.tag + ' has invalid characters.');
					blackList[lang.tag] = true;
				}
				else if (!lang.check(nameLang))
				{
					printErr(p, lang.tag + ' is not ' + lang.name + '.');
					blackList[lang.tag] = true;
				}	
			}
		}

		if (name === undefined) // *_to_name
		{

			var langCount = 0;
			for (key in p.tags) 
			{
				if (key.indexOf("name:") != -1) 
				{
					if (++langCount == 2) break; // Optimization. no point in counting more than 2
				}
			}
			if (langCount == 0) return; // No name tags at all.

			// if (p.tags["noname"] !== undefined) remove(p, "noname");

			if (langCount > 1)
			{
				printErr(p, 'Has no name tag, has multiple name:lang');	
				return;
			}
			
			// langCount = 1
			// note I = 1, preventing name:en => name.
			for (var i = 1; i < languages.length; ++i)
			{
				var lang = languages[i];
				if (blackList[lang.tag] === true) continue;
				var nameLang = p.tags[lang.tag];
				if (nameLang !== undefined) // considering name:lang => name
				{
					p.tags["name"] = nameLang;
					modifiedCnt++;
					lang.stats.toName++;
					return;
				}
			}
		}
		else // name exists, consider name_to_*
		{
			if (p.tags["noname"] !== undefined) remove(p, "noname");

			if (hasInvalidChars(name))
			{
				printErr(p, 'name has non printable characters.');
				return;
			}
			for (var i = 0; i < languages.length; ++i)
			{
				var lang = languages[i];
				var nameLang = p.tags[lang.tag];
				if (lang.check(name))
				{
					if (nameLang === undefined)
					{
						p.tags[lang.tag] = name;
						modifiedCnt++;
						lang.stats.fromName++;
					}
					else if (!sameValue(nameLang, name)) // normalized string comparison, ignoring spaces etc
					{
						var str = "name, " + lang.tag + " mismatch.";
						printErr(p, str);
						str += " Flagged by SafwatHalaby_bot#nameCopy";
						if (p2.tags.fixme === undefined)
							p2.tags.fixme = str;
						else
							p2.tags.fixme += ". " + str;
						/*
						autoFixAttempts++;
						if (traceAndFixMismatch(p, name, nameLang, lang)) //disabled, always returns false.
							autoFixSuccess++;
						else
							autoFixFail++;*/
					}
					return;
				}
			}
			printErr(p, "name is not ar,he,en");
		}
	});
	print("");
	print("Total names copies: " + modifiedCnt);
	var checksum = 0;
	for (var i = 0; i < languages.length; ++i)
	{
		var lang = languages[i];
		if (i != 0) // no need to print en to name, since it's always 0.
			print("Total " + lang.tag + " to name: " + lang.stats.toName);
		print("Total name to " + lang.tag + ": " + lang.stats.fromName);
		checksum += lang.stats.toName + lang.stats.fromName;
	}
	print("Whitespace fixes: " + gWhiteSpaceFixes);
	print("Total scanned: " + totalCnt);
	print("Total unhandled errors: " + gErrCnt);
	print("Total autofix attempts: " + autoFixAttempts);
	print("Total autofix success: " + autoFixSuccess);
	print("Total autofix fail: " + autoFixFail);
	if (checksum != modifiedCnt)
		print("SERIOUS ERROR: THIS SHOULD NEVER HAPPEN.");
	print("");
	print("### Script finished");
}
main();

