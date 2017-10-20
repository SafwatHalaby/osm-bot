/*
Script page: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/nameCopy
Last update: 20 Dec 2017
major version: 5
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

	way["name"](if:
		t["name"] != t["name:ar"] &&
		t["name"] != t["name:he"] &&
		t["name"] != t["name:en"] &&
		t["name"] != t["name:ru"]
	)(area.a);

	rel["name"](if:
		t["name"] != t["name:ar"] &&
		t["name"] != t["name:he"] &&
		t["name"] != t["name:en"] &&
		t["name"] != t["name:ru"]
	)(area.a);
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
	return ((str.search(/[^\u00A0\u0020-\u007E\u0590-\u05FF]/) === -1)  // only common symbols and ar letters
	&& (str.search(/[\u0590-\u05FF]/) !== -1)); // at least 1 he letter
}

function arEnOnly(str)
{
	return ((str.search(/[^\u00A0\u0020-\u007E\u0600-\u06FF]/) === -1)  // only common symbols and ar letters
	&& (str.search(/[\u0600-\u06FF]/) !== -1)); // at least 1 ar letter
}

function enOnly(str)
{
	return (str.search(/[^\u00A0\u0020-\u007E]/) === -1) && // Only common symbols and en letters
	(str.search(/[a-zA-Z]/) !== -1); // at least 1 en letter
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
{name: "English", tag: "name:en", check: enOnly, copyCnt: 0},
{name: "Hebrew", tag: "name:he", check: heEnOnly, copyCnt: 0},
{name: "Arabic", tag: "name:ar", check: arEnOnly, copyCnt: 0}
];

function addFixme(p, str)
{
	str += " Flagged by SafwatHalaby_bot-nameCopy";
	if (p.tags.fixme === undefined)
		p.tags.fixme = str;
	else
		p.tags.fixme += ". " + str;
		
	fixmeCnt++;
}

function main()
{
	var modifiedCnt = 0;
	var totalCnt = 0;
	var fixmeCnt = 0;
	var engFixCnt = 0;
	print("");
	print("### Running script");
	var layer = josm.layers.get(0);
	var ds = layer.data;
	ds.each(function(p) // for each element
	{
		totalCnt++;
		var name = p.tags["name"];

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

		if ((p.tags["name:en"] !== undefined) && (name === p.tags["name:en"]) && (!enOnly(p.tags["name:en"])))
		{
			// remove bug in previous version, where ascii sentences with no letters at all were copied to name:en
			p.removeTag("name:en");
			engFixCnt++;
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
				}
				else if (!lang.check(nameLang))
				{
					printErr(p, lang.tag + ' is not ' + lang.name + '.');
				}	
			}
		}
		
		if (name !== undefined) // name exists, consider name_to_*
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
						lang.copyCnt++;
					}
					else if (!sameValue(nameLang, name)) // normalized string comparison, ignoring spaces etc
					{
						var str = "name, " + lang.tag + " mismatch.";
						printErr(p, str);
						addFixme(p, str);
					}
					return;
				}
			}
			printErr(p, "name is not ar,he,en");
		}
	});
	print("");
	print("Total names copies: " + modifiedCnt);
	print("Total fixmes: " + fixmeCnt);
	print("Eng bugfixes: " + engFixCnt);
	var checksum = 0;
	for (var i = 0; i < languages.length; ++i)
	{
		var lang = languages[i];
		print("Total name to " + lang.tag + ": " + lang.copyCnt);
		checksum += lang.stats.toName + lang.copyCnt;
	}
	print("Whitespace fixes: " + gWhiteSpaceFixes);
	print("Total scanned: " + totalCnt);
	print("Total unhandled errors: " + gErrCnt);
	if (checksum != modifiedCnt)
		print("SERIOUS ERROR: THIS SHOULD NEVER HAPPEN.");
	print("");
	print("### Script finished");
}
main();

