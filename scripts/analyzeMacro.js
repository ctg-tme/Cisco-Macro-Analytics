String.prototype.capitalizeFirstLetter = function () {
  return this.toLowerCase().charAt(0).toUpperCase() + this.slice(1);   
};

/**
 * Analyzes a Macro JS file as a string and parse xAPI Types and Paths
 * 
 * Provides additional analytics about the Macro
 * 
 * Provdes warning if duplicate subcriptions are detected
 * 
 * @param macroContent the Macro'stext file
 * @param regex the RegEx to check the macro against
 */

window.analyzeMacro = function (macroContent) {
  const NewMacroSyntaxRegex = `xapi\\s*\\.(?<Type>Command|Status|Event|Config)\\s*\\.(?<Path>[A-Za-z0-9_\\s*\\.\\[\\]]+?)(?<Action>\\s*\\.(set|get|on|once))?\\(`;
  const OldMacroSyntaxRegex = `xapi\\.(?<Type>config|status|event|command)(?<Action>\\.(set|get|on|once))?\\('(?<Path>[A-Za-z0-9 ]+?[^']*)`;

  const newSyntaxMatches = [...macroContent.matchAll(NewMacroSyntaxRegex)];
  const oldSyntaxMatches = [...macroContent.matchAll(OldMacroSyntaxRegex)];

  function mapMatches(matches, syntaxType) {
    return matches.map(match => ({
      Type: (match.groups.Type || '').replace(/\./g, ' ').replace(/\s+/g, ' ').capitalizeFirstLetter(),
      Path: (match.groups.Path || '').replace(/\./g, ' ').replace(/\s+/g, ' '),
      Action: (match.groups.Action || '').replace(/\./g, '').replace(/\s+/g, '') || "N/A",
      Doc: `https://roomos.cisco.com/xapi/${(match.groups.Type.toLowerCase() == 'config' ? 'Configuration' : match.groups.Type.capitalizeFirstLetter())}.${match.groups.Path.replace(/\s+/g, '.')}/`,
      Syntax: syntaxType.capitalizeFirstLetter()
    }));
  }

  const initialArray = [
    ...mapMatches(newSyntaxMatches, 'New'),
    ...mapMatches(oldSyntaxMatches, 'Old')
  ];

  // Step 1: Count occurrences of each unique object in the original array
  const counts = initialArray.reduce((acc, item) => {
    const key = `${item.Type}-${item.Path}-${item.Action}`;  // Exclude Syntax here for uniqueness across both syntaxes
    acc[key] = (acc[key] || 0) + 1;

    // Increment the count for each type (Config, Command, Status, Event)
    if (!acc.types) {
      acc.types = {
        Config: { TotalCalls: 0, UniqueCalls: 0 },
        Command: { TotalCalls: 0, UniqueCalls: 0 },
        Status: { TotalCalls: 0, UniqueCalls: 0 },
        Event: { TotalCalls: 0, UniqueCalls: 0 }
      };
    }
    acc.types[item.Type].TotalCalls += 1;

    return acc;
  }, {
    types: {
      Config: { TotalCalls: 0, UniqueCalls: 0 },
      Command: { TotalCalls: 0, UniqueCalls: 0 },
      Status: { TotalCalls: 0, UniqueCalls: 0 },
      Event: { TotalCalls: 0, UniqueCalls: 0 }
    }
  });

  // Step 2: Count total subscribers (for 'on', 'once' or 'once' actions)
  let totalSubscribers = 0;
  let totalUniqueSubscribers = 0;
  const nonSubSet = new Set();
  const nonSubMap = new Map();
  const subscriberSet = new Set();
  const uniqueSubscribersMap = new Map();

  initialArray.forEach(item => {
    if (['on', 'once'].includes(item.Action)) {
      totalSubscribers += 1;
      const subscriberKey = `${item.Type}-${item.Path}-${item.Action}-${item.Syntax}`;
      if (!subscriberSet.has(subscriberKey)) {
        subscriberSet.add(subscriberKey);
        totalUniqueSubscribers += 1;  // Count only unique subscriptions
      }

      // Track unique subscriptions per type
      if (!uniqueSubscribersMap.has(subscriberKey)) {
        uniqueSubscribersMap.set(subscriberKey, { ...item, Recurrence: 1 });
      } else {
        uniqueSubscribersMap.get(subscriberKey).Recurrence += 1;
      }
    } else {
      const nonSubKey = `${item.Type}-${item.Path}-${item.Action}`;
      if (!nonSubSet.has(nonSubKey)) {
        nonSubSet.add(nonSubKey);
      }

      // Track unique non subscriptions per type
      if (!nonSubMap.has(nonSubKey)) {
        nonSubMap.set(nonSubKey, { ...item, Recurrence: 1 });
      } else {
        nonSubMap.get(nonSubKey).Recurrence += 1;
      }
    }
  });

  // Step 3: Create a new array with unique items, adding Recurrence and Subscription
  const resultArray = initialArray.map(item => {
    const key = `${item.Type}-${item.Path}-${item.Action}-${item.Syntax}`;  // Include Syntax in the key to distinguish between New/Old
    const recurrenceCount = counts[key];  // Get the count of this item
    const isSubscribed = ['on', 'once'].includes(item.Action);  // Set Subscription to true for 'on', 'once' or 'once'

    return {
      ...item,  // Copy the original item properties
      Recurrence: recurrenceCount,  // Add Recurrence count
      Subscription: isSubscribed     // Add Subscription boolean
    };
  });

  // Step 4: Remove duplicates based on the Type, Path, and Action combination (ignoring Syntax)
  const uniqueArray = Array.from(new Map(resultArray.map(item => [`${item.Type}-${item.Path}-${item.Action}`, item])).values());

  // Step 5: Count total and unique subscriptions per API Type
  const typeAnalytics = {
    Config: { TotalSubscribers: 0, TotalUniqueSubscribers: 0, TotalCalls: 0, UniqueCalls: 0 },
    Command: { TotalSubscribers: 0, TotalUniqueSubscribers: 0, TotalCalls: 0, UniqueCalls: 0 },
    Status: { TotalSubscribers: 0, TotalUniqueSubscribers: 0, TotalCalls: 0, UniqueCalls: 0 },
    Event: { TotalSubscribers: 0, TotalUniqueSubscribers: 0, TotalCalls: 0, UniqueCalls: 0 }
  };

  initialArray.forEach(item => {
    typeAnalytics[item.Type].TotalCalls += 1;
    if (item.Action.includes('on', 'once')) {
      typeAnalytics[item.Type].TotalSubscribers += 1;
    }
  });

  uniqueArray.forEach(item => {
    typeAnalytics[item.Type].UniqueCalls += 1;
    if (['on', 'once'].includes(item.Action)) {
      typeAnalytics[item.Type].TotalUniqueSubscribers += 1;
    }
  });

  // Step 6: Create the final analytics object
  const analytics = {
    Total_xAPI_Calls_Found: initialArray.length,  // Total number of Calls in the original array
    Unique_xAPI_Calls_Found: uniqueArray.length,  // Number of unique Calls considering both New and Old syntaxes
    Total_xAPI_Subscriptions_Found: totalSubscribers,  // Correctly count subscriptions (including duplicates)
    Unique_xAPI_Subscriptions_Found: totalUniqueSubscribers,  // Correctly count unique subscriptions
    BranchBreakdown: {
      Configuration: {
        Total_xAPI_Calls_Found: typeAnalytics.Config.TotalCalls,
        Unique_xAPI_Calls_Found: typeAnalytics.Config.UniqueCalls,
        Total_xAPI_Subscriptions_Found: typeAnalytics.Config.TotalUniqueSubscribers,
        Unique_xAPI_Subscriptions_Found: typeAnalytics.Config.TotalSubscribers
      },
      Command: {
        Total_xAPI_Calls_Found: typeAnalytics.Command.TotalCalls,
        Unique_xAPI_Calls_Found: typeAnalytics.Command.UniqueCalls,
        Total_xAPI_Subscriptions_Found: 'N/A',  // Commands do not have subscribers
        Unique_xAPI_Subscriptions_Found: 'N/A'
      },
      Status: {
        Total_xAPI_Calls_Found: typeAnalytics.Status.TotalCalls,
        Unique_xAPI_Calls_Found: typeAnalytics.Status.UniqueCalls,
        Total_xAPI_Subscriptions_Found: typeAnalytics.Status.TotalSubscribers,
        Unique_xAPI_Subscriptions_Found: typeAnalytics.Status.TotalUniqueSubscribers
      },
      Event: {
        Total_xAPI_Calls_Found: typeAnalytics.Event.TotalCalls,
        Unique_xAPI_Calls_Found: typeAnalytics.Event.UniqueCalls,
        Total_xAPI_Subscriptions_Found: typeAnalytics.Event.TotalSubscribers,
        Unique_xAPI_Subscriptions_Found: typeAnalytics.Event.TotalUniqueSubscribers
      }
    }
  };

  uniqueArray.forEach(item => {
    delete item.Syntax;
  });

  uniqueArray.forEach((item, index) => {
    const itemKey = `${item.Type}.${item.Path}.${item.Action}`
    uniqueSubscribersMap.forEach(el => {
      const elKey = `${el.Type}.${el.Path}.${el.Action}`
      if (itemKey == elKey) {
        uniqueArray[index].Recurrence = el.Recurrence
      }
    })

    nonSubMap.forEach(el => {
      const elKey = `${el.Type}.${el.Path}.${el.Action}`
      if (itemKey == elKey) {
        uniqueArray[index].Recurrence = el.Recurrence
      }
    })
  })

  const report = {
    Analytics: analytics,
    APIReferences: uniqueArray
  };

  const warnings = [];

  // Step 7: Evaluate data for possible warnings to relay to Developers
  const duplicateSubscribers = [];
  let syntaxTypes = [];
  let oldSyntaxCalls = [];


  uniqueSubscribersMap.forEach((value, key) => {
    syntaxTypes.push(value.Syntax)
    if (value.Syntax == 'Old') {
      oldSyntaxCalls.push(value);
    }
    if (value.Recurrence > 1) {
      if (value.Syntax === "New") {
        value.SearchStrings = {
          ObjectPath: `xapi.${value.Type}`,
          APIPath: `${value.Path.replaceAll(/\s+/g, '.')}${value.Action ? `.${value.Action}` : ''}`,
          FullPath: `xapi.${value.Type}.${value.Path.replaceAll(/\s+/g, '.')}${value.Action ? `.${value.Action}` : ''}`
        };
      } else if (value.Syntax === "Old") {
        value.SearchStrings = {
          ObjectPath: `xapi.${value.Type.toLowerCase()}.${value.Action}`,
          APIPath: `${value.Path.replaceAll(/\s+/g, ' ')}`,
          FullPath: `Unable to parse full path as the API Path can be surrounded by a mix of delimiters including Single Quotes ' Double Quotes " and BackTicks \.`
        };
      }
      duplicateSubscribers.push(value);  // Add to duplicate list
    }
  });

  if (duplicateSubscribers.length > 0) {
    warnings.push({
      Message: 'Duplicate Subscribers were found in your macro and could be problematic. Please review the list of duplicate subscribers below.',
      Duplicates: duplicateSubscribers
    })
  }

  nonSubMap.forEach((value, key) => {
    syntaxTypes.push(value.Syntax)
    if (value.Syntax == 'Old') {
      oldSyntaxCalls.push(value);
    }
  });

  syntaxTypes = Array.from(new Set(syntaxTypes));

  if (syntaxTypes.includes('Old') && syntaxTypes.includes('New')) {
    warnings.push({
      Message: `You're macro contains a mix of Old and New macro syntax. Old Syntax will work without issues, but it's best to write macros using New Syntax and to not mix syntax structures to improve readability and future maintenance.`,
      Resource: `https://roomos.cisco.com/doc/TechDocs/JSXAPIStyles`,
      Old_Syntax_Calls: oldSyntaxCalls
    })
  }

  if (syntaxTypes.includes('Old') && !syntaxTypes.includes('New')) {
    warnings.push({
      Message: `You're macro is written using Old Syntax. Old Syntax will work without issues, but it's best to write macros using New Syntax to improve readability and future maintenance`,
      Resource: `https://roomos.cisco.com/doc/TechDocs/JSXAPIStyles`,
      Old_Syntax_Calls: oldSyntaxCalls
    })
  }

  const typeAnalyticsList = Object.keys(typeAnalytics)

  typeAnalyticsList.forEach(item => {
    if (typeAnalytics[item].TotalCalls > typeAnalytics[item].UniqueCalls) {
      warnings.push({
        Message: `You have [${typeAnalytics[item].TotalCalls}] total xAPI [${item}] references with only [${typeAnalytics[item].UniqueCalls}] uniques Calls found. Leveraging functions may help reduce the number of duplicate xAPI Calls in you macro, making you macro easier to support and troubleshoot`
      })
    }
  })

  let finalReport = {}

  if (warnings.length > 0) {
    finalReport.Warnings = warnings;
  }

  finalReport.APIReferences = report.APIReferences;
  finalReport.Analytics = report.Analytics;

  // Step 8: Return the final result containing Analytics, the unique API references, and the Warning
  return finalReport;
}