# Summary formulas

Daily Log: A date, B workout Yes/No, C clean Yes/No, D drinks (whole number >= 0), E-G timestamps/message ID, H status. Blank counts are unknown. Only numeric zero means alcohol-free.

Set the following cells in Summary:

**A1**

```text
Year
```

**B1**

```text
=YEAR(TODAY())
```

**A2**

```text
Metric
```

**B2**

```text
Value
```

**A3**

```text
Answered days
```

**B3**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete")
```

**A4**

```text
Workout
```

**B4**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes")
```

**A5**

```text
Ate clean
```

**B5**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!C2:C,"Yes")
```

**A6**

```text
Alcohol-free (0 drinks)
```

**B6**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!D2:D,0,'Daily Log'!D2:D,"<>")
```

**A7**

```text
Workout + clean
```

**B7**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes",'Daily Log'!C2:C,"Yes")
```

**A8**

```text
Workout + 0 drinks
```

**B8**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes",'Daily Log'!D2:D,0,'Daily Log'!D2:D,"<>")
```

**A9**

```text
Clean + 0 drinks
```

**B9**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!C2:C,"Yes",'Daily Log'!D2:D,0,'Daily Log'!D2:D,"<>")
```

**A10**

```text
Workout + clean + 0 drinks
```

**B10**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,"Yes",'Daily Log'!C2:C,"Yes",'Daily Log'!D2:D,0,'Daily Log'!D2:D,"<>")
```



**A12**

```text
Custom combination
```

**B12**

```text
Yes/No/Any; drinks: count/Any
```

**A13**

```text
Workout
```

**B13**

```text
Any
```

**A14**

```text
Ate clean
```

**B14**

```text
Any
```

**A15**

```text
Drinks (exact count)
```

**B15**

```text
Any
```

**A16**

```text
Matching days
```

**B16**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!B2:B,IF(B13="Any","<>",B13),'Daily Log'!C2:C,IF(B14="Any","<>",B14),'Daily Log'!D2:D,IF(B15="Any",">=0",B15),'Daily Log'!D2:D,"<>")
```

**A17**

```text
Total drinks
```

**B17**

```text
=SUMIFS('Daily Log'!D2:D,'Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete")
```

**A18**

```text
Days with drinks
```

**B18**

```text
=COUNTIFS('Daily Log'!A2:A,">="&DATE(B1,1,1),'Daily Log'!A2:A,"<"&DATE(B1+1,1,1),'Daily Log'!H2:H,"Complete",'Daily Log'!D2:D,">0")
```



**A20**

```text
Blank counts are unknown
```

**B20**

```text
Only 0 means alcohol-free.
```

Validation: B13:B14 offer Any/Yes/No; B15 permits Any or a nonnegative whole number. Daily Log D2:D permits blanks or nonnegative whole numbers.
