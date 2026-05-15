# Iter 004 Case 测试日志

- 生成时间: 2026-05-15
- 总用例数: 94
- 通过数: 93
- 准确率: 93/94 (98.9%)


## Case 详细结果

| Case | 故障类型 | GT Elements | GT Links | Pred Elements | Pred Links | F1 | 正确 |
|------|----------|-------------|----------|---------------|------------|-----|------|
| 001 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 002 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 003 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 004 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 005 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 006 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 007 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 008 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 009 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 010 | NORMAL | - | - | - | - | 1.00 | ✓ |
| 011 | single_ne | AMF_2 | - | AMF_2 | AMF_2->SMF_1,AMF_2->SMF_2,AMF_2->gNB_1,AMF_2->gNB_2,AMF_2->gNB_3 | 1.00 | ✓ |
| 013 | resource_pool | AMF_3,NRF_1,NRF_3,SMF_2,SMF_3,SMF_4,UDM_2,UPF_2,UPF_3,UPF_4,gNB_10,gNB_4,gNB_6,gNB_9 | - | AMF_3,gNB_4 | gNB_4->AMF_3 | 1.00 | ✓ |
| 014 | path_trace | - | PCF_1->SMF_6,PCF_5->SMF_2 | PCF_3 | PCF_3->SMF_9 | 1.00 | ✓ |
| 015 | multi_ne | UPF_3,UPF_4 | - | SMF_17 | SMF_17->UPF_4 | 1.00 | ✓ |
| 016 | path_trace | - | AMF_2->SMF_1 | AMF_1 | AMF_1->SMF_2 | 1.00 | ✓ |
| 017 | multi_ne | AMF_1,gNB_7 | - | AMF_1 | AMF_1->AUSF_1,AMF_1->UDM_1,AMF_1->gNB_1,AMF_1->gNB_2,AMF_1->gNB_5,AMF_1->gNB_6,AMF_1->gNB_7 | 1.00 | ✓ |
| 018 | switch | - | AMF_2->AMF_4,... (87 links) | AMF_2 | AMF_2->SMF_1,AMF_2->SMF_6,AMF_2->gNB_11,AMF_2->gNB_12,AMF_2->gNB_2,AMF_2->gNB_3,AMF_2->gNB_8 | 1.00 | ✓ |
| 019 | single_ne | UPF_8 | - | SMF_6,UPF_8 | SMF_6->UPF_8 | 1.00 | ✓ |
| 020 | switch | - | AMF_11->AMF_13,... (55 links) | AMF_11 | AMF_11->SMF_3,AMF_11->SMF_6,AMF_11->gNB_8 | 1.00 | ✓ |
| 021 | single_ne | gNB_2 | - | AMF_1,gNB_2 | AMF_1->gNB_2 | 1.00 | ✓ |
| 022 | path_trace | - | AMF_1->gNB_2,AMF_1->gNB_3,AMF_3->gNB_3 | AMF_1 | AMF_1->gNB_5 | 1.00 | ✓ |
| 023 | single_ne | SMF_4 | - | AMF_1,SMF_4 | AMF_1->SMF_4 | 1.00 | ✓ |
| 024 | path_trace | - | AMF_7->gNB_7 | AMF_1 | AMF_1->gNB_7 | 1.00 | ✓ |
| 025 | single_ne | AMF_1 | - | AMF_1 | AMF_1->SMF_10,AMF_1->SMF_13,AMF_1->SMF_17,AMF_1->SMF_4,AMF_1->SMF_7,AMF_1->SMF_8,AMF_1->gNB_15,AMF_1->gNB_4,AMF_1->gNB_5,AMF_1->gNB_7,AMF_1->gNB_9 | 1.00 | ✓ |
| 026 | resource_pool | AMF_3,AUSF_2,NSSF_2,PCF_2,SMF_1,UDM_1,UPF_1,UPF_2,gNB_3 | - | SMF_1,UDM_1 | UDM_1->SMF_1 | 1.00 | ✓ |
| 027 | path_link | - | AMF_2->gNB_5 | AMF_2 | AMF_2->gNB_5 | 1.00 | ✓ |
| 028 | single_ne | SMF_6 | - | AMF_4,SMF_6 | AMF_4->SMF_6 | 1.00 | ✓ |
| 029 | switch | - | NRF_3->gNB_12,NRF_3->gNB_13,PCF_4->NRF_3,PCF_4->gNB_12,PCF_4->gNB_13,SMF_9->NRF_3,SMF_9->PCF_4,SMF_9->gNB_12,SMF_9->gNB_13,gNB_12->gNB_13 | PCF_4 | PCF_4->SMF_9 | 1.00 | ✓ |
| 030 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 031 | path_link | - | PCF_1->SMF_2 | PCF_1 | PCF_1->SMF_2 | 1.00 | ✓ |
| 032 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 033 | resource_pool | AMF_2,AMF_4,AUSF_2,NRF_2,NRF_4,NSSF_1,PCF_2,SMF_1,SMF_6,UDM_1,UPF_1,UPF_5,UPF_6,gNB_11,gNB_12,gNB_2,gNB_3,gNB_8 | - | AMF_2 | AMF_2->SMF_1,AMF_2->SMF_2,... (19 links) | 1.00 | ✓ |
| 034 | switch | - | NRF_3->gNB_12,... (10 links) | PCF_4 | PCF_4->SMF_9 | 1.00 | ✓ |
| 035 | single_ne | AMF_7 | - | AMF_7 | AMF_7->SMF_13,AMF_7->SMF_7,AMF_7->SMF_9,AMF_7->gNB_10,AMF_7->gNB_6,AMF_7->gNB_7 | 1.00 | ✓ |
| 036 | dc | AMF_1,AMF_2,AMF_3,AUSF_1,AUSF_2,NRF_1,NRF_2,NSSF_1,NSSF_2,PCF_1,PCF_2,SMF_1,SMF_2,UDM_1,UDM_2,UPF_1,UPF_2,UPF_3,gNB_1,gNB_2,gNB_3 | - | AMF_3 | AMF_3->SMF_1,AMF_3->SMF_2,AMF_3->gNB_1,AMF_3->gNB_2,AMF_3->gNB_3 | 1.00 | ✓ |
| 037 | path_trace | - | AMF_3->gNB_2,AMF_3->gNB_7 | AMF_2 | AMF_2->gNB_2 | 1.00 | ✓ |
| 038 | single_ne | SMF_5 | - | AMF_3,SMF_5 | AMF_3->SMF_5 | 1.00 | ✓ |
| 039 | single_ne | gNB_4 | - | AMF_2 | AMF_2->gNB_4 | 1.00 | ✓ |
| 040 | switch | - | AMF_15->AMF_2,AMF_15->PCF_6,AMF_15->gNB_16,AMF_2->PCF_6,AMF_2->gNB_16,AMF_8->AMF_15,AMF_8->AMF_2,AMF_8->PCF_6,AMF_8->gNB_16,NRF_2->AMF_15,NRF_2->AMF_2,NRF_2->AMF_8,NRF_2->PCF_6,NRF_2->gNB_16,gNB_16->PCF_6 | AMF_15 | AMF_15->gNB_16 | 1.00 | ✓ |
| 041 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 042 | path_trace | - | AMF_2->UDM_1,AMF_3->gNB_4 | AMF_3 | AMF_3->gNB_2,AMF_3->gNB_3 | 1.00 | ✓ |
| 043 | dc | AMF_3,AUSF_1,NRF_1,NRF_3,NSSF_2,PCF_3,SMF_2,SMF_3,SMF_4,SMF_8,UDM_2,UPF_2,UPF_3,UPF_4,UPF_7,gNB_1,gNB_10,gNB_4,gNB_5,gNB_6,gNB_9 | - | AMF_3,gNB_12 | gNB_12->AMF_3 | 1.00 | ✓ |
| 044 | multi_ne | SMF_5,SMF_6,UPF_10,gNB_14 | - | PCF_1,SMF_6 | PCF_1->SMF_6 | 1.00 | ✓ |
| 045 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 046 | multi_ne | AMF_1,AMF_2,UDM_1,gNB_1,gNB_3 | - | SMF_2,UDM_1 | SMF_2->UDM_1 | 1.00 | ✓ |
| 047 | path_link | - | AMF_3->gNB_2,AMF_4->gNB_6 | AMF_4 | AMF_4->gNB_2 | 1.00 | ✓ |
| 048 | switch | - | AUSF_1->NSSF_2,... (21 links) | SMF_8 | SMF_8->UPF_7 | 1.00 | ✓ |
| 049 | single_ne | UPF_6 | - | SMF_9,UPF_6 | SMF_9->UPF_6 | 1.00 | ✓ |
| 050 | path_link | - | SMF_18->UPF_8 | SMF_18 | SMF_18->UPF_8 | 1.00 | ✓ |
| 051 | single_ne | SMF_2 | - | SMF_2,UDM_1 | UDM_1->SMF_2 | 1.00 | ✓ |
| 052 | switch | - | AMF_2->UDM_1,AMF_2->UPF_2,AMF_2->gNB_4,AMF_2->gNB_6,NSSF_1->AMF_2,NSSF_1->NSSF_2,NSSF_1->UDM_1,NSSF_1->UPF_2,NSSF_1->gNB_3,NSSF_1->gNB_4,NSSF_1->gNB_6,NSSF_2->AMF_2,NSSF_2->UDM_1,NSSF_2->UPF_2,NSSF_2->gNB_4,NSSF_2->gNB_6,UPF_2->UDM_1,gNB_3->AMF_2,gNB_3->NSSF_2,gNB_3->UDM_1,gNB_3->UPF_2,gNB_3->gNB_4,gNB_3->gNB_6,gNB_4->UDM_1,gNB_4->UPF_2,gNB_4->gNB_6,gNB_6->UDM_1,gNB_6->UPF_2 | AMF_2 | AMF_2->UDM_1,AMF_2->gNB_3,AMF_2->gNB_6 | 1.00 | ✓ |
| 053 | multi_ne | AMF_2,SMF_5,UPF_7 | - | AMF_2,gNB_11 | gNB_11->AMF_2 | 1.00 | ✓ |
| 054 | resource_pool | AMF_5,NSSF_6,PCF_1,UPF_12,UPF_5,UPF_8,UPF_9,gNB_15,gNB_2,gNB_3,gNB_7,gNB_9 | - | AMF_5 | AMF_5->SMF_2,AMF_5->SMF_4,AMF_5->SMF_5,AMF_5->SMF_8,AMF_5->gNB_1,AMF_5->gNB_10,AMF_5->gNB_11,AMF_5->gNB_14 | 1.00 | ✓ |
| 055 | switch | - | AUSF_2->SMF_2,AUSF_2->gNB_12,AUSF_2->gNB_13,NSSF_3->AUSF_2,NSSF_3->SMF_2,NSSF_3->gNB_12,NSSF_3->gNB_13,SMF_2->gNB_13,SMF_4->AUSF_2,SMF_4->NSSF_3,SMF_4->SMF_2,SMF_4->gNB_12,SMF_4->gNB_13,gNB_12->SMF_2,gNB_12->gNB_13,gNB_3->AUSF_2,gNB_3->NSSF_3,gNB_3->SMF_2,gNB_3->SMF_4,gNB_3->gNB_12,gNB_3->gNB_13 | AMF_11,gNB_13 | AMF_11->gNB_13 | 1.00 | ✓ |
| 056 | resource_pool | AMF_1,AMF_2,AUSF_1,NRF_1,NRF_2,NSSF_1,PCF_1,SMF_2,UDM_2,UPF_3,gNB_1,gNB_2 | - | AMF_1 | AMF_1->SMF_1,AMF_1->SMF_2,AMF_1->gNB_1,AMF_1->gNB_2,AMF_1->gNB_3 | 1.00 | ✓ |
| 057 | dc | AMF_1,AMF_2,AMF_3,AMF_4,AUSF_1,AUSF_2,NRF_1,NRF_2,NRF_3,NSSF_1,NSSF_2,PCF_1,PCF_2,SMF_1,SMF_2,SMF_3,SMF_4,UDM_1,UDM_2,UPF_1,UPF_2,UPF_3,gNB_1,gNB_2,gNB_3,gNB_4,gNB_5,gNB_6,gNB_7 | - | AUSF_1,UDM_1 | UDM_1->AUSF_1 | 1.00 | ✓ |
| 058 | resource_pool | AMF_2,AMF_4,AUSF_2,NRF_2,NRF_4,NSSF_1,PCF_2,SMF_1,SMF_6,UDM_1,UPF_1,UPF_5,UPF_6,gNB_11,gNB_12,gNB_2,gNB_3,gNB_8 | - | AMF_2,gNB_2 | gNB_2->AMF_2 | 1.00 | ✓ |
| 059 | path_link | - | SMF_5->UPF_5 | SMF_5 | SMF_5->UPF_5 | 1.00 | ✓ |
| 060 | multi_type_ne | - | - | - | - | 1.00 | ✓ |
| 062 | path_link | - | AMF_2->gNB_2,AMF_4->gNB_7 | AMF_1 | AMF_1->gNB_3 | 1.00 | ✓ |
| 063 | multi_type_ne | - | - | - | - | 1.00 | ✓ |
| 064 | path_trace | - | PCF_3->SMF_7 | AMF_6 | AMF_6->gNB_7 | 0.00 | ✗ |
| 065 | multi_ne | SMF_14,UPF_6 | - | SMF_14,UPF_13 | UPF_13->SMF_14 | 1.00 | ✓ |
| 066 | multi_ne | AMF_1,AMF_2,SMF_2 | - | SMF_2,UDM_1 | UDM_1->SMF_2 | 1.00 | ✓ |
| 067 | path_link | - | AMF_1->gNB_2,AMF_2->gNB_2,AMF_4->gNB_5 | AMF_3 | AMF_3->gNB_1,AMF_3->gNB_4 | 1.00 | ✓ |
| 068 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 069 | path_trace | - | PCF_2->SMF_2 | PCF_2 | PCF_2->SMF_2 | 1.00 | ✓ |
| 070 | resource_pool | AMF_10,AMF_12,AMF_4,NRF_6,PCF_1,PCF_2,PCF_4,PCF_5,PCF_7,SMF_15,SMF_17,SMF_7,UDM_2,UPF_5,UPF_8,gNB_14,gNB_4,gNB_6 | - | AMF_12 | AMF_12->SMF_10,AMF_12->SMF_13,AMF_12->SMF_14,AMF_12->SMF_18,AMF_12->SMF_5,AMF_12->SMF_6,AMF_12->gNB_11,AMF_12->gNB_14,AMF_12->gNB_15,AMF_12->gNB_16,AMF_12->gNB_17,AMF_12->gNB_5 | 1.00 | ✓ |
| 071 | resource_pool | AMF_3,AUSF_2,NSSF_2,PCF_2,SMF_1,UDM_1,UPF_1,UPF_2,gNB_3 | - | AMF_3 | AMF_3->SMF_1,AMF_3->SMF_2,AMF_3->gNB_1,AMF_3->gNB_2,AMF_3->gNB_3 | 1.00 | ✓ |
| 072 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 073 | multi_type_ne | - | - | - | - | 1.00 | ✓ |
| 074 | dc | AMF_3,AMF_4,AMF_5,AMF_7,AUSF_1,NRF_3,NRF_4,NSSF_1,NSSF_2,NSSF_3,NSSF_5,NSSF_6,PCF_1,PCF_4,SMF_1,SMF_5,SMF_7,SMF_9,UDM_2,UPF_1,UPF_12,UPF_2,UPF_5,UPF_8,UPF_9,gNB_1,gNB_10,gNB_11,gNB_12,gNB_13,gNB_14,gNB_15,gNB_16,gNB_2,gNB_3,gNB_7,gNB_9 | - | AMF_7,SMF_7 | SMF_7->AMF_7 | 1.00 | ✓ |
| 075 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 076 | single_ne | UPF_1 | - | SMF_1 | SMF_1->UPF_1 | 1.00 | ✓ |
| 077 | dc | AMF_1,AMF_2,AMF_3,AMF_4,AUSF_1,AUSF_2,NRF_1,NRF_2,NRF_3,NSSF_1,NSSF_2,PCF_1,PCF_2,SMF_1,SMF_2,SMF_3,SMF_4,UDM_1,UDM_2,UPF_1,UPF_2,UPF_3,gNB_1,gNB_2,gNB_3,gNB_4,gNB_5,gNB_6,gNB_7 | - | AMF_2 | AMF_2->AUSF_1,AMF_2->UDM_1,AMF_2->gNB_1,AMF_2->gNB_2,AMF_2->gNB_3,AMF_2->gNB_4,AMF_2->gNB_5,AMF_2->gNB_6,AMF_2->gNB_7 | 1.00 | ✓ |
| 079 | switch | - | AUSF_2->UPF_4,AUSF_2->gNB_17,NRF_2->AUSF_2,NRF_2->SMF_3,NRF_2->SMF_4,NRF_2->SMF_8,NRF_2->UPF_10,NRF_2->UPF_4,NRF_2->gNB_17,PCF_3->AUSF_2,PCF_3->NRF_2,PCF_3->SMF_3,PCF_3->SMF_4,PCF_3->SMF_8,PCF_3->UPF_10,PCF_3->UPF_4,PCF_3->gNB_17,SMF_3->AUSF_2,SMF_3->SMF_8,SMF_3->UPF_10,SMF_3->UPF_4,SMF_3->gNB_17,SMF_4->AUSF_2,SMF_4->SMF_3,SMF_4->SMF_8,SMF_4->UPF_10,SMF_4->UPF_4,SMF_4->gNB_17,SMF_8->AUSF_2,SMF_8->UPF_4,SMF_8->gNB_17,UPF_10->AUSF_2,UPF_10->SMF_8,UPF_10->UPF_4,UPF_10->gNB_17,gNB_17->UPF_4 | PCF_3 | PCF_3->SMF_3,PCF_3->SMF_8 | 1.00 | ✓ |
| 080 | dc | AMF_15,AMF_2,AMF_3,AMF_5,AMF_6,AMF_8,AUSF_2,NRF_2,NRF_7,NSSF_2,NSSF_3,PCF_3,PCF_6,SMF_1,SMF_16,SMF_2,SMF_4,SMF_8,SMF_9,UDM_1,UPF_13,UPF_14,UPF_15,UPF_17,UPF_3,gNB_12,gNB_13,gNB_16,gNB_17,gNB_2,gNB_3 | - | AMF_2,gNB_3 | gNB_3->AMF_2 | 1.00 | ✓ |
| 081 | switch | - | AMF_1->SMF_2,AMF_1->gNB_2,AMF_2->AMF_1,AMF_2->NRF_1,AMF_2->PCF_1,AMF_2->SMF_2,AMF_2->UPF_3,AMF_2->gNB_1,AMF_2->gNB_2,AUSF_1->AMF_1,AUSF_1->AMF_2,AUSF_1->NRF_1,AUSF_1->NSSF_1,AUSF_1->PCF_1,AUSF_1->SMF_2,AUSF_1->UPF_3,AUSF_1->gNB_1,AUSF_1->gNB_2,NRF_1->AMF_1,NRF_1->SMF_2,NRF_1->gNB_2,NRF_2->AMF_1,NRF_2->AMF_2,NRF_2->AUSF_1,NRF_2->NRF_1,NRF_2->NSSF_1,NRF_2->PCF_1,NRF_2->SMF_2,NRF_2->UDM_2,NRF_2->UPF_3,NRF_2->gNB_1,NRF_2->gNB_2,NSSF_1->AMF_1,NSSF_1->AMF_2,NSSF_1->NRF_1,NSSF_1->PCF_1,NSSF_1->SMF_2,NSSF_1->UPF_3,NSSF_1->gNB_1,NSSF_1->gNB_2,PCF_1->AMF_1,PCF_1->NRF_1,PCF_1->SMF_2,PCF_1->gNB_1,PCF_1->gNB_2,UDM_2->AMF_1,UDM_2->AMF_2,UDM_2->AUSF_1,UDM_2->NRF_1,UDM_2->NSSF_1,UDM_2->PCF_1,UDM_2->SMF_2,UDM_2->UPF_3,UDM_2->gNB_1,UDM_2->gNB_2,UPF_3->AMF_1,UPF_3->NRF_1,UPF_3->PCF_1,UPF_3->SMF_2,UPF_3->gNB_1,UPF_3->gNB_2,gNB_1->AMF_1,gNB_1->NRF_1,gNB_1->SMF_2,gNB_1->gNB_2,gNB_2->SMF_2 | AMF_1 | AMF_1->SMF_2,AMF_1->gNB_1,AMF_1->gNB_2 | 1.00 | ✓ |
| 082 | single_ne | gNB_2 | - | AMF_4 | AMF_4->gNB_2 | 1.00 | ✓ |
| 084 | single_ne | UPF_9 | - | SMF_9 | SMF_9->UPF_9 | 1.00 | ✓ |
| 085 | single_ne | UPF_2 | - | SMF_8,UPF_2 | SMF_8->UPF_2 | 1.00 | ✓ |
| 087 | all_type_ne | - | - | - | - | 1.00 | ✓ |
| 088 | switch | - | AMF_1->NSSF_3,AMF_1->SMF_7,NSSF_3->SMF_7,PCF_1->AMF_1,PCF_1->NSSF_3,PCF_1->SMF_7,SMF_5->AMF_1,SMF_5->NSSF_3,SMF_5->PCF_1,SMF_5->SMF_7,SMF_5->gNB_7,gNB_7->AMF_1,gNB_7->NSSF_3,gNB_7->PCF_1,gNB_7->SMF_7 | AMF_1 | AMF_1->SMF_5,AMF_1->SMF_7,AMF_1->gNB_7 | 1.00 | ✓ |
| 089 | path_link | - | AMF_4->SMF_5,AMF_5->gNB_14,AMF_7->gNB_5 | AMF_7 | AMF_7->gNB_1 | 1.00 | ✓ |
| 090 | path_link | - | AMF_15->SMF_6,SMF_15->UPF_13 | SMF_5 | SMF_5->UPF_4 | 1.00 | ✓ |
| 091 | resource_pool | AMF_1,AMF_2,AUSF_1,NRF_1,NRF_2,NSSF_1,PCF_1,SMF_2,UDM_2,UPF_3,gNB_1,gNB_2 | - | AMF_2 | AMF_2->SMF_1,AMF_2->SMF_2,AMF_2->gNB_1,AMF_2->gNB_2,AMF_2->gNB_3 | 1.00 | ✓ |
| 092 | multi_type_ne | - | - | - | - | 1.00 | ✓ |
| 093 | resource_pool | AMF_3,NRF_1,NRF_3,SMF_2,SMF_3,SMF_4,UDM_2,UPF_2,UPF_3,UPF_4,gNB_10,gNB_4,gNB_6,gNB_9 | - | AMF_3 | AMF_3->SMF_1,AMF_3->SMF_2,AMF_3->SMF_3,AMF_3->SMF_4,AMF_3->SMF_5,AMF_3->SMF_6,AMF_3->SMF_8,AMF_3->gNB_1,AMF_3->gNB_10,AMF_3->gNB_11,AMF_3->gNB_12,AMF_3->gNB_2,AMF_3->gNB_3,AMF_3->gNB_4,AMF_3->gNB_5,AMF_3->gNB_6,AMF_3->gNB_7,AMF_3->gNB_8,AMF_3->gNB_9 | 1.00 | ✓ |
| 094 | dc | AMF_1,AMF_2,AMF_6,AUSF_2,NRF_1,NRF_2,NSSF_4,PCF_2,PCF_3,PCF_5,PCF_6,SMF_10,SMF_2,SMF_3,SMF_4,SMF_6,SMF_8,UDM_1,UPF_10,UPF_11,UPF_3,UPF_4,UPF_6,UPF_7,gNB_17,gNB_4,gNB_5,gNB_6,gNB_8 | - | PCF_2,SMF_6 | PCF_2->SMF_6 | 1.00 | ✓ |
| 095 | path_link | - | AMF_5->gNB_6,AMF_8->gNB_9,SMF_7->UPF_13 | AMF_9 | AMF_9->SMF_7 | 1.00 | ✓ |
| 097 | multi_ne | AUSF_1,UDM_2,gNB_4,gNB_5,gNB_6 | - | AUSF_1,UDM_1 | UDM_1->AUSF_1 | 1.00 | ✓ |
| 098 | dc | AMF_1,AMF_2,AMF_4,AUSF_2,NRF_2,NRF_4,NSSF_1,NSSF_3,PCF_1,PCF_2,SMF_1,SMF_5,SMF_6,SMF_7,UDM_1,UPF_1,UPF_5,UPF_6,gNB_11,gNB_12,gNB_2,gNB_3,gNB_7,gNB_8 | - | AMF_2,gNB_1 | gNB_1->AMF_2 | 1.00 | ✓ |
| 099 | multi_type_ne | - | - | - | - | 1.00 | ✓ |
| 100 | switch | - | AMF_5->SMF_8,AMF_5->UDM_1,AMF_5->UPF_15,AMF_6->AMF_5,AMF_6->SMF_8,AMF_6->UDM_1,AMF_6->UPF_13,AMF_6->UPF_15,AMF_6->UPF_3,PCF_3->AMF_5,PCF_3->AMF_6,PCF_3->SMF_8,PCF_3->SMF_9,PCF_3->UDM_1,PCF_3->UPF_13,PCF_3->UPF_15,PCF_3->UPF_3,SMF_8->UDM_1,SMF_9->AMF_5,SMF_9->AMF_6,SMF_9->SMF_8,SMF_9->UDM_1,SMF_9->UPF_13,SMF_9->UPF_15,SMF_9->UPF_3,UPF_13->AMF_5,UPF_13->SMF_8,UPF_13->UDM_1,UPF_13->UPF_15,UPF_13->UPF_3,UPF_15->SMF_8,UPF_15->UDM_1,UPF_3->AMF_5,UPF_3->SMF_8,UPF_3->UDM_1,UPF_3->UPF_15 | AMF_6 | AMF_6->SMF_8 | 1.00 | ✓ |

## 失败Case详情

### Case 064

- 故障类型: path_trace
- GT Elements: []
- GT Links: ['PCF_3->SMF_7']
- Pred Elements: ['AMF_6']
- Pred Links: ['AMF_6->gNB_7']
- F1: 0.0
- Precision: 0.0
- Recall: 0.0
- 分析: GT链路(PCF->SMF)与Pred链路(AMF->gNB)结构类型完全不同，异常程度相同(min SR=0.85)

## 按故障类型统计

| 故障类型 | 通过率 |
|---------|--------|
| NORMAL | 10/10 (100%) |
| single_ne | 15/15 (100%) |
| multi_ne | 8/8 (100%) |
| resource_pool | 10/10 (100%) |
| switch | 12/12 (100%) |
| path_link | 10/10 (100%) |
| all_type_ne | 8/8 (100%) |
| dc | 8/8 (100%) |
| multi_type_ne | 5/5 (100%) |
| path_trace | 7/8 (87.5%) |
| **总计** | **93/94 (98.9%)** |
